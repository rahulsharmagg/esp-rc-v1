/**
 * ============================================================================
 * Project: ESP32 BLE RC & Autonomous Obstacle-Avoiding Robot (esp32_car)
 * Hardware:
 *   - ESP32 Dev Board (Core 3.x)
 *   - L298N Dual H-Bridge Motor Driver
 *   - SG90 Micro Servo (Pan / Scan)
 *   - HC-SR04 Ultrasonic Distance Sensor
 *   - 2x IR Obstacle Sensors (Left & Right)
 * 
 * Communication:
 *   - Web Bluetooth Low Energy (Nordic UART Service)
 *   - Service UUID: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   - Rx Characteristic: 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
 *   - Tx Characteristic: 6E400003-B5A3-F393-E0A9-E50E24DCCA9E
 * ============================================================================
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>

// Firmware Version & OTA Configuration
static const char FIRMWARE_VERSION[] = "1.0.3";
static const char DEFAULT_OTA_URL[]  = "https://raw.githubusercontent.com/rahulsharmagg/esp-rc-v1/main/firmware/esp32/1.0.3/firmware.bin";

// Wi-Fi Power & Connection State (Defaults OFF to maximize battery life)
bool wifiRadioEnabled = false;
String activeConnectedSsid = "";
String targetConnectingSsid = "";
unsigned long wifiConnectStartTime = 0;
bool isConnectingWifi = false;
bool isScanningWifiActive = false;
unsigned long wifiScanStartTime = 0;

// Wi-Fi Async Scan Result Queue to prevent packet dropping without blocking loop()
int scanResultCount = 0;
int currentScanDispatchIndex = 0;
unsigned long lastScanDispatchMillis = 0;

// ============================================================================
// HARDWARE PIN DEFINITIONS (Organized by Physical Header Banks)
// ============================================================================

// --- BANK A (LEFT HEADER LOWER): L298N DUAL MOTOR DRIVER ---
#define ENA 14  // Left motor PWM (GPIO 14)
#define IN1 27  // Left motor direction 1 (GPIO 27)
#define IN2 26  // Left motor direction 2 (GPIO 26)
#define ENB 25  // Right motor PWM (GPIO 25)
#define IN3 33  // Right motor direction 1 (GPIO 33)
#define IN4 32  // Right motor direction 2 (GPIO 32)

// --- BANK B (LEFT HEADER UPPER): DEDICATED INPUT SENSORS ---
#define BATTERY_PIN 36  // ADC1 GPIO 36 (VP) - 20k:10k Voltage divider (3.0 ratio)
#define IR_LEFT     34  // Left IR Obstacle Sensor (Input-only GPIO 34)
#define IR_RIGHT    35  // Right IR Obstacle Sensor (Input-only GPIO 35)
#define IR_OBSTACLE_STATE LOW // LOW = obstacle detected for active-low IR modules

// --- BANK C (RIGHT HEADER LOWER): ULTRASONIC SENSOR & PAN SERVO GIMBAL ---
#define SERVO_PIN 5   // SG90 Pan Servo PWM (GPIO 5)
#define TRIG_PIN  18  // HC-SR04 TRIG Output (GPIO 18)
#define ECHO_PIN  19  // HC-SR04 ECHO Input (GPIO 19 via 10k:20k or 1k:2k voltage divider)

// --- BANK D (RIGHT HEADER UPPER): LIGHTING, AUDIO & ONBOARD STATUS ---
#define HEADLIGHT_LEFT_PIN  22  // Front Left Headlight LED (GPIO 22)
#define HEADLIGHT_RIGHT_PIN 23  // Front Right Headlight LED (GPIO 23)
#define BUZZER_PIN          21  // Active Horn Buzzer (GPIO 21)
#define STATUS_LED_PIN      2   // Built-in Blue Onboard LED (Solid=Connected, Blink=Searching)

bool isHeadlightsOn = false;

// 2S Li-ion Battery Monitor Config (20k / 10k voltage divider => 3.0 ratio)
static const float BATTERY_DIVIDER_RATIO = 3.0f; // Ratio = (20k + 10k) / 10k = 3.0
static const float BATTERY_FULL_V        = 8.4f; // 2S Li-ion 100%
static const float BATTERY_EMPTY_V       = 6.4f; // 2S Li-ion 0% (3.2V per cell cutoff)

// Rolling average buffer to eliminate motor PWM electrical ripple
static float smoothedBatteryVolts = 7.8f;

int getBatteryLevel(float &outVolts) {
  // Fast 4-sample ADC read without blocking delays
  uint32_t sum = analogRead(BATTERY_PIN);
  sum += analogRead(BATTERY_PIN);
  sum += analogRead(BATTERY_PIN);
  sum += analogRead(BATTERY_PIN);
  float raw = sum / 4.0f;

  // Return -1 (NO BATTERY) if ADC pin is floating/unwired (raw < 50)
  if (raw < 50.0f) {
    outVolts = 0.0f;
    smoothedBatteryVolts = 0.0f;
    return -1;
  }

  // ADC conversion: 12-bit (0-4095) with 11dB attenuation (0 - ~3.3V reference)
  float pinV = (raw / 4095.0f) * 3.3f;
  float instantBatV = pinV * BATTERY_DIVIDER_RATIO;

  // Exponential moving average filter (EMA alpha = 0.15)
  smoothedBatteryVolts = (smoothedBatteryVolts * 0.85f) + (instantBatV * 0.15f);
  outVolts = smoothedBatteryVolts;

  // Calculate percentage
  float pctFloat = ((smoothedBatteryVolts - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100.0f;
  int pct = (int)constrain(pctFloat, 0.0f, 100.0f);
  return pct;
}

// ============================================================================
// PWM & MOTOR TIMINGS
// ============================================================================
static const int PWM_FREQ = 1000;
static const int PWM_RES  = 8; // 8-bit = 0-255

// Speed Presets
volatile int currentSpeed = 180;
static const int TURN_SPEED = 170;
static const int SAFE_DISTANCE_CM = 20;

// Autonomous Timings (ms)
static const int IR_BACKWARD_TIME      = 250;
static const int IR_TURN_TIME          = 400;
static const int BOTH_IR_BACKWARD_TIME = 400;
static const int BOTH_IR_TURN_TIME     = 400;
static const int ULTRASONIC_TURN_TIME  = 450;

// Safety failsafe timeout for manual mode
#define FAILSAFE_TIMEOUT_MS 600

// ============================================================================
// SENSOR ENABLE/DISABLE REGISTRY
// ============================================================================
bool enableUltrasonic = true;
bool enableServo      = true;
bool enableIrLeft     = false; // Default false so missing IR sensors don't lock auto-avoid
bool enableIrRight    = false; // Default false

// ============================================================================
// BLE DEFINITIONS
// ============================================================================
#define DEVICE_NAME             "ESP32-RC-CAR"
#define SERVICE_UUID            "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Servo Object & Positions
Servo scanServo;
static const int SERVO_CENTER = 90;
static const int SERVO_LEFT   = 150;
static const int SERVO_RIGHT  = 30;
int currentServoAngle         = SERVO_CENTER;

// Operating Modes
enum DriveMode {
  MODE_MANUAL = 0,
  MODE_AUTO_AVOID = 1,
  MODE_AUTO_PATROL = 2
};

DriveMode currentMode = MODE_MANUAL;

// BLE Server State
BLEServer* pServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

volatile unsigned long lastCommandTimestamp = 0;
char lastCommandChar = 'S';
unsigned long lastTelemetryMillis = 0;
long lastMeasuredCenterDist = 100;
bool lastLeftIrBlocked = false;
bool lastRightIrBlocked = false;

// Motor Pin State Cache to prevent redundant bus traffic
static int cachedLeftSpeed = -1;
static int cachedRightSpeed = -1;

// Forward Declarations
void stopMotors();
void setSpeeds(int leftSpeed, int rightSpeed);
void moveForward();
void moveBackward();
void turnLeft();
void turnRight();
void decideDirectionAndTurn();
long getDistanceCM();
void notifyBle(const char* msg);
void notifyBle(const String& msg);

// ============================================================================
// MOTOR CONTROL PRIMITIVES
// ============================================================================

void setSpeeds(int leftSpeed, int rightSpeed) {
  leftSpeed = constrain(leftSpeed, 0, 255);
  rightSpeed = constrain(rightSpeed, 0, 255);

  if (leftSpeed != cachedLeftSpeed) {
    ledcWrite(ENA, leftSpeed);
    cachedLeftSpeed = leftSpeed;
  }
  if (rightSpeed != cachedRightSpeed) {
    ledcWrite(ENB, rightSpeed);
    cachedRightSpeed = rightSpeed;
  }
}

void moveForward() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed, currentSpeed);
}

void moveBackward() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed, currentSpeed);
}

void turnLeft() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  setSpeeds(TURN_SPEED, TURN_SPEED);
}

void turnRight() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  setSpeeds(TURN_SPEED, TURN_SPEED);
}

void forwardLeft() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed / 2, currentSpeed);
}

void forwardRight() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed, currentSpeed / 2);
}

void reverseLeft() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed / 2, currentSpeed);
}

void reverseRight() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed, currentSpeed / 2);
}

void stopMotors() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  setSpeeds(0, 0);
}

// Drive differential / tank style: left (-255 to +255), right (-255 to +255)
void setDifferential(int left, int right) {
  left = constrain(left, -255, 255);
  right = constrain(right, -255, 255);

  if (left > 0) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
  } else if (left < 0) {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
  }

  if (right > 0) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  } else if (right < 0) {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  } else {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, LOW);
  }

  setSpeeds(abs(left), abs(right));
}

// ============================================================================
// STATUS LED, DUAL HEADLIGHT LEDS & HORN ACTUATORS
// ============================================================================

// Non-blocking Status LED Blink State
unsigned long lastStatusLedBlinkMillis = 0;
bool statusLedBlinkState = false;
static const unsigned long STATUS_LED_BLINK_INTERVAL_MS = 350;

void updateStatusLed() {
  if (deviceConnected) {
    // Bluetooth Connected -> Solid ON
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else {
    // Bluetooth Disconnected / Searching -> Blink
    unsigned long currentMillis = millis();
    if (currentMillis - lastStatusLedBlinkMillis >= STATUS_LED_BLINK_INTERVAL_MS) {
      lastStatusLedBlinkMillis = currentMillis;
      statusLedBlinkState = !statusLedBlinkState;
      digitalWrite(STATUS_LED_PIN, statusLedBlinkState ? HIGH : LOW);
    }
  }
}

void setHeadlights(bool on) {
  isHeadlightsOn = on;
  digitalWrite(HEADLIGHT_LEFT_PIN, on ? HIGH : LOW);
  digitalWrite(HEADLIGHT_RIGHT_PIN, on ? HIGH : LOW);
  Serial.printf("[LIGHTS] Dual Headlights: %s (LED 1: GPIO %d | LED 2: GPIO %d)\n",
                on ? "ON" : "OFF", HEADLIGHT_LEFT_PIN, HEADLIGHT_RIGHT_PIN);
}

void setHorn(bool on) {
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  Serial.printf("[HORN] Buzzer: %s (GPIO %d)\n", on ? "ON" : "OFF", BUZZER_PIN);
}

// ============================================================================
// ULTRASONIC DISTANCE SENSOR (Optimized Non-Blocking Pulse Timeout)
// ============================================================================

long getDistanceCM() {
  if (!enableUltrasonic) return -1;

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 18ms timeout (~300cm max range) keeps loop() fast and responsive
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 18000);
  if (duration == 0) {
    return -1;
  }
  return (long)(duration * 0.0343f / 2.0f);
}

// ============================================================================
// ULTRASONIC & SERVO DECISION LOGIC (Look Left, Look Right)
// ============================================================================

void decideDirectionAndTurn() {
  if (!enableServo || !enableUltrasonic) {
    turnRight();
    delay(ULTRASONIC_TURN_TIME);
    stopMotors();
    return;
  }

  long leftDist;
  long rightDist;

  // 1. Look LEFT
  scanServo.write(SERVO_LEFT);
  currentServoAngle = SERVO_LEFT;
  delay(280);
  leftDist = getDistanceCM();

  // 2. Look RIGHT
  scanServo.write(SERVO_RIGHT);
  currentServoAngle = SERVO_RIGHT;
  delay(380);
  rightDist = getDistanceCM();

  // 3. Return to CENTER
  scanServo.write(SERVO_CENTER);
  currentServoAngle = SERVO_CENTER;
  delay(240);

  if (leftDist < 0) leftDist = 400;
  if (rightDist < 0) rightDist = 400;

  Serial.printf("[AUTO SCAN] Left: %ld cm | Right: %ld cm\n", leftDist, rightDist);

  // Turn towards the clearer direction
  if (leftDist > rightDist) {
    Serial.println("[AUTO] Decision -> Turning LEFT");
    turnLeft();
    delay(ULTRASONIC_TURN_TIME);
  } else {
    Serial.println("[AUTO] Decision -> Turning RIGHT");
    turnRight();
    delay(ULTRASONIC_TURN_TIME);
  }

  stopMotors();
}

// ============================================================================
// AUTONOMOUS ROUTINE (Priority: IR Dual -> IR Left -> IR Right -> Ultrasonic)
// ============================================================================

void runAutonomousObstacleAvoidance() {
  // 1. Read IR Sensors (if enabled)
  bool leftBlocked  = enableIrLeft ? (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE) : false;
  bool rightBlocked = enableIrRight ? (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE) : false;
  lastLeftIrBlocked = leftBlocked;
  lastRightIrBlocked = rightBlocked;

  // 2. Read Ultrasonic Distance (if enabled)
  long distanceCenter = enableUltrasonic ? getDistanceCM() : -1;
  if (distanceCenter > 0) lastMeasuredCenterDist = distanceCenter;

  // PRIORITY 1: Both IR Sensors Blocked
  if (leftBlocked && rightBlocked) {
    Serial.println("[AUTO] Both IR sensors blocked!");
    stopMotors();
    moveBackward();
    delay(BOTH_IR_BACKWARD_TIME);
    turnRight();
    delay(BOTH_IR_TURN_TIME);
    stopMotors();
    return;
  }

  // PRIORITY 2: Left IR Sensor Blocked
  if (leftBlocked) {
    Serial.println("[AUTO] Left IR blocked!");
    stopMotors();
    moveBackward();
    delay(IR_BACKWARD_TIME);
    turnRight();
    delay(IR_TURN_TIME);
    stopMotors();
    return;
  }

  // PRIORITY 3: Right IR Sensor Blocked
  if (rightBlocked) {
    Serial.println("[AUTO] Right IR blocked!");
    stopMotors();
    moveBackward();
    delay(IR_BACKWARD_TIME);
    turnLeft();
    delay(IR_TURN_TIME);
    stopMotors();
    return;
  }

  // PRIORITY 4: Ultrasonic Center Detection (< 20 cm)
  if (enableUltrasonic && distanceCenter > 0 && distanceCenter < SAFE_DISTANCE_CM) {
    Serial.println("[AUTO] Ultrasonic obstacle detected!");
    stopMotors();
    decideDirectionAndTurn();
    return;
  }

  // Path Clear -> Cruise Forward
  moveForward();
  delay(15);
}

// ============================================================================
// WI-FI & BLE NOTIFICATION ROUTINES (Zero Heap Fragmentation)
// ============================================================================

void notifyBle(const char* msg) {
  if (deviceConnected && pTxCharacteristic) {
    pTxCharacteristic->setValue((uint8_t*)msg, strlen(msg));
    pTxCharacteristic->notify();
  }
}

void notifyBle(const String& msg) {
  notifyBle(msg.c_str());
}

void scanWifiNetworks() {
  if (!wifiRadioEnabled) {
    WiFi.mode(WIFI_STA);
    delay(50);
    wifiRadioEnabled = true;
  }
  Serial.println("[WIFI] Initiating async 2.4GHz network scan...");
  WiFi.scanDelete(); // Clear previous cache
  WiFi.scanNetworks(true); // Non-blocking background scan
  isScanningWifiActive = true;
  wifiScanStartTime = millis();
  scanResultCount = 0;
  currentScanDispatchIndex = 0;
  notifyBle("WIFI_SCAN_START");
}

void connectWifi(const String& ssid, const String& pass) {
  if (!wifiRadioEnabled) {
    WiFi.mode(WIFI_STA);
    wifiRadioEnabled = true;
  }
  Serial.printf("[WIFI] Connecting to SSID: %s\n", ssid.c_str());
  targetConnectingSsid = ssid;
  isConnectingWifi = true;
  wifiConnectStartTime = millis();

  if (pass.length() > 0) {
    WiFi.begin(ssid.c_str(), pass.c_str());
  } else {
    WiFi.begin(ssid.c_str());
  }
}

void disconnectWifi() {
  WiFi.disconnect(true);
  activeConnectedSsid = "";
  isConnectingWifi = false;
  notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
  Serial.println("[WIFI] Disconnected from network.");
}

void turnWifiRadioOff() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiRadioEnabled = false;
  activeConnectedSsid = "";
  isConnectingWifi = false;
  notifyBle("WIFI_STATUS:OFF:0.0.0.0:0:");
  Serial.println("[WIFI] Radio POWERED OFF (Battery Saver Active)");
}

// ============================================================================
// OVER-THE-AIR (OTA) FIRMWARE UPDATE
// ============================================================================

void performOTAUpdate(String firmwareUrl) {
  if (WiFi.status() != WL_CONNECTED) {
    notifyBle("OTA_ERROR:WiFi Not Connected");
    Serial.println("[OTA] WiFi Not Connected!");
    return;
  }

  if (firmwareUrl.length() == 0) {
    firmwareUrl = DEFAULT_OTA_URL;
  }

  Serial.printf("[OTA] Starting OTA flash from: %s\n", firmwareUrl.c_str());
  notifyBle("OTA_PROGRESS:10:Connecting to firmware host...");
  stopMotors();

  httpUpdate.onProgress([](size_t current, size_t final) {
    if (final > 0) {
      int pct = (int)((current * 100) / final);
      static int lastReportedPct = -1;
      if (pct != lastReportedPct && pct % 5 == 0) {
        lastReportedPct = pct;
        char progBuf[64];
        snprintf(progBuf, sizeof(progBuf), "OTA_PROGRESS:%d:Writing firmware to flash...", pct);
        notifyBle(progBuf);
        Serial.printf("[OTA] Flash progress: %d%%\n", pct);
      }
    }
  });

  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(false);

  t_httpUpdate_return ret = HTTP_UPDATE_FAILED;

  if (firmwareUrl.startsWith("https://")) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // Download binary without hardcoding CA root certificates
    secureClient.setHandshakeTimeout(30);
    ret = httpUpdate.update(secureClient, firmwareUrl);

    // Fallback to plain HTTP if HTTPS is refused or fails due to TLS/memory limits
    if (ret == HTTP_UPDATE_FAILED) {
      String plainHttpUrl = "http://" + firmwareUrl.substring(8);
      Serial.printf("[OTA] HTTPS failed. Attempting HTTP fallback: %s\n", plainHttpUrl.c_str());
      WiFiClient plainClient;
      ret = httpUpdate.update(plainClient, plainHttpUrl);
    }
  } else {
    WiFiClient plainClient;
    ret = httpUpdate.update(plainClient, firmwareUrl);
  }

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] HTTP_UPDATE_FAILED Error (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      notifyBle("OTA_ERROR:" + httpUpdate.getLastErrorString());
      break;

    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] HTTP_UPDATE_NO_UPDATES");
      notifyBle("OTA_ERROR:No update available");
      break;

    case HTTP_UPDATE_OK:
      Serial.println("[OTA] HTTP_UPDATE_OK - Firmware flashed! Rebooting ESP32...");
      notifyBle("OTA_COMPLETE");
      delay(500);
      ESP.restart();
      break;
  }
}

// ============================================================================
// MOTION & BLUETOOTH COMMAND HANDLER
// ============================================================================

void processCommand(const String& cmd) {
  if (cmd.length() == 0) return;

  lastCommandTimestamp = millis();
  char c = cmd.charAt(0);

  // 0. OTA Firmware Flash Command ("OTA:UPDATE", "OTA:UPDATE:<url>", "OTA:VERSION")
  if (cmd.startsWith("OTA:UPDATE")) {
    String url = "";
    if (cmd.length() > 10 && cmd.charAt(10) == ':') {
      url = cmd.substring(11);
    }
    performOTAUpdate(url);
    return;
  }
  if (cmd == "OTA:VERSION" || cmd == "FIRMWARE:VERSION") {
    char verBuf[32];
    snprintf(verBuf, sizeof(verBuf), "FIRMWARE_VER:%s", FIRMWARE_VERSION);
    notifyBle(verBuf);
    return;
  }

  // 0.1 Wi-Fi Control Commands (e.g. "WIFI:SCAN", "WIFI:CONN:SSID:PASS", "WIFI:OFF")
  if (cmd.startsWith("WIFI:")) {
    String sub = cmd.substring(5);
    if (sub == "SCAN") {
      scanWifiNetworks();
    } else if (sub.startsWith("CONN:")) {
      int secondColon = sub.indexOf(':', 5);
      String ssid, pass;
      if (secondColon != -1) {
        ssid = sub.substring(5, secondColon);
        pass = sub.substring(secondColon + 1);
      } else {
        ssid = sub.substring(5);
        pass = "";
      }
      connectWifi(ssid, pass);
    } else if (sub == "DISC") {
      disconnectWifi();
    } else if (sub == "OFF") {
      turnWifiRadioOff();
    } else if (sub == "ON") {
      if (!wifiRadioEnabled) {
        WiFi.mode(WIFI_STA);
        wifiRadioEnabled = true;
        notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
      }
    } else if (sub == "STATUS") {
      if (!wifiRadioEnabled) {
        notifyBle("WIFI_STATUS:OFF:0.0.0.0:0:");
      } else if (WiFi.status() == WL_CONNECTED) {
        char statusBuf[96];
        snprintf(statusBuf, sizeof(statusBuf), "WIFI_STATUS:CONNECTED:%s:%d:%s",
                 WiFi.localIP().toString().c_str(), WiFi.RSSI(), WiFi.SSID().c_str());
        notifyBle(statusBuf);
      } else {
        notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
      }
    }
    return;
  }

  // 1. Sensor Enable / Disable Toggles (e.g. "E:US:0", "E:IRL:1")
  if (c == 'E' && cmd.charAt(1) == ':') {
    int secondColon = cmd.indexOf(':', 2);
    if (secondColon != -1) {
      String sensorKey = cmd.substring(2, secondColon);
      bool state = cmd.substring(secondColon + 1).toInt() == 1;

      if (sensorKey == "US") {
        enableUltrasonic = state;
        Serial.printf("[SENSOR CONFIG] Ultrasonic Sensor: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "SRV") {
        enableServo = state;
        Serial.printf("[SENSOR CONFIG] SG90 Servo: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "IRL") {
        enableIrLeft = state;
        Serial.printf("[SENSOR CONFIG] Left IR Sensor: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "IRR") {
        enableIrRight = state;
        Serial.printf("[SENSOR CONFIG] Right IR Sensor: %s\n", state ? "ENABLED" : "DISABLED");
      }
      return;
    }
  }

  // 2. Servo Manual Angle Positioning (e.g. "P:90", "P:150")
  if (c == 'P' && cmd.charAt(1) == ':') {
    int angle = cmd.substring(2).toInt();
    angle = constrain(angle, 0, 180);
    scanServo.write(angle);
    currentServoAngle = angle;
    Serial.printf("[SERVO] Manual angle set to %d deg\n", angle);
    return;
  }

  // 3. Single Ping Command ("PING")
  if (cmd == "PING") {
    long d = getDistanceCM();
    if (d > 0) lastMeasuredCenterDist = d;
    Serial.printf("[TEST] Ping result: %ld cm\n", d);
    return;
  }

  // 4. Mode Selection Commands ('X' or 'A' = AUTOMATIC, 'M' or 'a' = MANUAL)
  if (c == 'A' || c == 'X') {
    currentMode = MODE_AUTO_AVOID;
    scanServo.write(SERVO_CENTER);
    currentServoAngle = SERVO_CENTER;
    Serial.println("[MODE] Engaged: AUTOMATIC (Obstacle Avoidance)");
    return;
  }
  if (c == 'a' || c == 'M') {
    currentMode = MODE_MANUAL;
    stopMotors();
    scanServo.write(SERVO_CENTER);
    currentServoAngle = SERVO_CENTER;
    Serial.println("[MODE] Engaged: MANUAL");
    return;
  }
  if (c == 'K') { // Manual Servo Sweep Test Trigger from App
    Serial.println("[SERVO] Manual Scan Sweep Triggered from App");
    decideDirectionAndTurn();
    return;
  }

  // 5. Dual Headlight LEDs Toggle ('W' = ON, 'w' = OFF)
  if (c == 'W') {
    setHeadlights(true);
    return;
  }
  if (c == 'w') {
    setHeadlights(false);
    return;
  }

  // 6. Horn Buzzer ('U' = Sound ON, 'u' = Sound OFF)
  if (c == 'U') {
    setHorn(true);
    return;
  }
  if (c == 'u') {
    setHorn(false);
    return;
  }

  // 7. Throttle / Speed Command (e.g. "V200")
  if (c == 'V') {
    int val = cmd.substring(1).toInt();
    currentSpeed = constrain(val, 50, 255);
    Serial.printf("[CONFIG] Speed set to: %d\n", currentSpeed);
    return;
  }

  // 8. Differential Tank Drive (e.g. "D:180,-180")
  if (c == 'D' && cmd.charAt(1) == ':') {
    currentMode = MODE_MANUAL;
    int commaIdx = cmd.indexOf(',');
    if (commaIdx > 2) {
      int leftPwr = cmd.substring(2, commaIdx).toInt();
      int rightPwr = cmd.substring(commaIdx + 1).toInt();
      setDifferential(leftPwr, rightPwr);
      return;
    }
  }

  // 9. Directional Motion Commands (Manual Touch Inputs)
  currentMode = MODE_MANUAL;
  lastCommandChar = c;

  switch (c) {
    case 'F': moveForward();   break;
    case 'B': moveBackward();  break;
    case 'L': turnLeft();      break;
    case 'R': turnRight();     break;
    case 'G': forwardLeft();   break;
    case 'I': forwardRight();  break;
    case 'H': reverseLeft();   break;
    case 'J': reverseRight();  break;
    case 'S':
    default:
      stopMotors();
      break;
  }
}

// ============================================================================
// BLE CALLBACKS
// ============================================================================

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    currentMode = MODE_MANUAL;
    stopMotors();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();

    if (rxValue.length() > 0) {
      processCommand(rxValue);

      // Fast echo acknowledgment (zero dynamic allocation)
      if (deviceConnected && pTxCharacteristic) {
        char ack[64];
        snprintf(ack, sizeof(ack), "ACK:%s", rxValue.c_str());
        pTxCharacteristic->setValue((uint8_t*)ack, strlen(ack));
        pTxCharacteristic->notify();
      }
    }
  }
};

// ============================================================================
// MAIN SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(50);

  Serial.println();
  Serial.println("==========================================");
  Serial.println(" ESP32 BLE Obstacle-Avoiding RC Car v1.0.2");
  Serial.println(" Hardware: L298N + SG90 Servo + HC-SR04 + 2x IR");
  Serial.println(" Core 3.x | Web Bluetooth Nordic UART");
  Serial.println("==========================================");

  // 1. Motor direction pins
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  // 2. ESP32 Core 3.x PWM on ENA & ENB
  ledcAttach(ENA, PWM_FREQ, PWM_RES);
  ledcAttach(ENB, PWM_FREQ, PWM_RES);

  // 3. Ultrasonic sensor pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // 4. ADC & IR Input Pins
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db); // 0-3.3V ADC measuring range
  pinMode(BATTERY_PIN, INPUT);
  pinMode(IR_LEFT, INPUT);
  pinMode(IR_RIGHT, INPUT);

  // 5. SG90 Servo Configuration (Allocate timers for Core 3.x compatibility)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  scanServo.setPeriodHertz(50);
  scanServo.attach(SERVO_PIN, 500, 2400);

  // Startup Sweep Test (Left -> Right -> Center)
  Serial.println("[SERVO] Testing sweep: LEFT -> RIGHT -> CENTER...");
  scanServo.write(SERVO_LEFT);
  delay(300);
  scanServo.write(SERVO_RIGHT);
  delay(450);
  scanServo.write(SERVO_CENTER);
  delay(250);
  Serial.println("[SERVO] Sweep test complete.");

  // 6. Bluetooth Status LED, Dual Headlight LEDs & Buzzer Initialization
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  pinMode(HEADLIGHT_LEFT_PIN, OUTPUT);
  pinMode(HEADLIGHT_RIGHT_PIN, OUTPUT);
  setHeadlights(false);

  pinMode(BUZZER_PIN, OUTPUT);
  setHorn(false);

  // 7. Stop Motors initially
  stopMotors();

  // 8. Initialize BLE Stack
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Tx Notify Characteristic
  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // Rx Write Characteristic
  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::setMTU(512); // Request 512-byte ATT MTU
  BLEDevice::startAdvertising();

  // 9. Start with Wi-Fi Radio OFF (Battery Saver Mode)
  WiFi.mode(WIFI_OFF);

  Serial.println("[READY] BLE Advertising active. Ready for PWA pairing.");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  unsigned long currentMillis = millis();

  // 0. Non-blocking Bluetooth Status LED Update (Solid when connected, Blinks when searching)
  updateStatusLed();

  // 1. Non-Blocking Wi-Fi Scan Result Dispatcher (No dropped BLE notifications & no loop stalls)
  if (isScanningWifiActive) {
    int16_t scanResult = WiFi.scanComplete();
    if (scanResult >= 0) {
      if (scanResultCount == 0) {
        scanResultCount = scanResult;
        currentScanDispatchIndex = 0;
        Serial.printf("[WIFI] Async scan complete. Found %d networks.\n", scanResult);
        char countBuf[32];
        snprintf(countBuf, sizeof(countBuf), "WIFI_SCAN_START:%d", scanResult);
        notifyBle(countBuf);
      }

      // Dispatch 1 network notification every 25ms in non-blocking fashion
      if (currentMillis - lastScanDispatchMillis >= 25) {
        lastScanDispatchMillis = currentMillis;

        if (currentScanDispatchIndex < scanResultCount && currentScanDispatchIndex < 15) {
          String ssid = WiFi.SSID(currentScanDispatchIndex);
          if (ssid.length() > 0) {
            int rssi = WiFi.RSSI(currentScanDispatchIndex);
            bool enc = (WiFi.encryptionType(currentScanDispatchIndex) != WIFI_AUTH_OPEN);
            char netMsg[80];
            snprintf(netMsg, sizeof(netMsg), "WIFI_NET:%s:%d:%d", ssid.c_str(), rssi, enc ? 1 : 0);
            notifyBle(netMsg);
            Serial.printf("  [%d] %s (%d dBm)\n", currentScanDispatchIndex + 1, ssid.c_str(), rssi);
          }
          currentScanDispatchIndex++;
        } else {
          // Finished dispatching all networks
          isScanningWifiActive = false;
          WiFi.scanDelete();
          notifyBle("WIFI_SCAN_END");
        }
      }
    } else if (scanResult == -2 || (currentMillis - wifiScanStartTime > 10000)) {
      // Scan failed or timed out
      isScanningWifiActive = false;
      WiFi.scanDelete();
      Serial.println("[WIFI] Scan failed or timed out.");
      notifyBle("WIFI_SCAN_END");
    }
  }

  // 2. Non-Blocking Wi-Fi Connection State Monitor
  if (isConnectingWifi && wifiRadioEnabled) {
    if (WiFi.status() == WL_CONNECTED) {
      isConnectingWifi = false;
      activeConnectedSsid = WiFi.SSID();
      String ip = WiFi.localIP().toString();
      int rssi = WiFi.RSSI();
      char connBuf[96];
      snprintf(connBuf, sizeof(connBuf), "WIFI_STATUS:CONNECTED:%s:%d:%s", ip.c_str(), rssi, activeConnectedSsid.c_str());
      notifyBle(connBuf);
      Serial.printf("[WIFI] Connected to %s! IP: %s (RSSI: %d dBm)\n", activeConnectedSsid.c_str(), ip.c_str(), rssi);
    } else if (currentMillis - wifiConnectStartTime > 12000) {
      isConnectingWifi = false;
      notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
      Serial.println("[WIFI] Connection timed out / failed.");
    }
  }

  // 3. Auto Re-Advertising on Client Disconnect
  if (!deviceConnected && oldDeviceConnected) {
    delay(100);
    pServer->startAdvertising();
    Serial.println("[BLE] Restarted advertising after disconnect.");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    lastCommandTimestamp = currentMillis;
    currentMode = MODE_MANUAL;
    char verBuf[32];
    snprintf(verBuf, sizeof(verBuf), "FIRMWARE_VER:%s", FIRMWARE_VERSION);
    notifyBle(verBuf);
    Serial.println("[BLE] Client connected and synchronized!");
  }

  // 4. Mode Execution: Autonomous vs Manual
  if (currentMode == MODE_AUTO_AVOID) {
    runAutonomousObstacleAvoidance();
  } else {
    // Manual Mode Safety: Failsafe stop if command stream stalls
    if (deviceConnected) {
      if (lastCommandChar != 'S' && (currentMillis - lastCommandTimestamp > FAILSAFE_TIMEOUT_MS)) {
        stopMotors();
        lastCommandChar = 'S';
      }
    } else {
      stopMotors();
    }
  }

  // 5. Telemetry Stream to PWA (every 100ms when connected) - Zero Heap Allocation
  if (deviceConnected && (currentMillis - lastTelemetryMillis >= 100)) {
    lastTelemetryMillis = currentMillis;
    unsigned long uptimeSec = currentMillis / 1000;

    // Read fast distance in manual mode if robot is stationary
    if (currentMode == MODE_MANUAL && lastCommandChar == 'S') {
      long d = enableUltrasonic ? getDistanceCM() : -1;
      if (d > 0) lastMeasuredCenterDist = d;
      lastLeftIrBlocked = enableIrLeft ? (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE) : false;
      lastRightIrBlocked = enableIrRight ? (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE) : false;
    }

    // Packet format: T:<uptime>,<center_dist_cm>,<ir_left>,<ir_right>,<servo_angle>,<battery_pct>,<battery_v>,<mode>
    char modeChar = (currentMode == MODE_AUTO_AVOID) ? 'A' : 'M';
    float batV = 7.8f;
    int batPct = getBatteryLevel(batV);

    char telemetry[64];
    snprintf(telemetry, sizeof(telemetry), "T:%lu,%ld,%d,%d,%d,%d,%.2f,%c",
             uptimeSec,
             lastMeasuredCenterDist,
             lastLeftIrBlocked ? 1 : 0,
             lastRightIrBlocked ? 1 : 0,
             currentServoAngle,
             batPct,
             batV,
             modeChar);

    pTxCharacteristic->setValue((uint8_t*)telemetry, strlen(telemetry));
    pTxCharacteristic->notify();
  }

  delay(2);
}
