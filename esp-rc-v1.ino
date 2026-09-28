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

// Wi-Fi Power & Connection State (Defaults OFF to maximize battery life)
bool wifiRadioEnabled = false;
String activeConnectedSsid = "";
String targetConnectingSsid = "";
unsigned long wifiConnectStartTime = 0;
bool isConnectingWifi = false;

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================

// Left Motor (L298N)
#define ENA 14  // Left motor PWM
#define IN1 27  // Left motor direction 1
#define IN2 26  // Left motor direction 2

// Right Motor (L298N)
#define ENB 25  // Right motor PWM
#define IN3 33  // Right motor direction 1
#define IN4 32  // Right motor direction 2

// Servo
#define SERVO_PIN 13

// Ultrasonic Sensor (HC-SR04)
#define TRIG_PIN 5
#define ECHO_PIN 18  // Use voltage divider: 5V -> 3.3V

// IR Obstacle Sensors (Input-only GPIOs)
#define IR_LEFT  34
#define IR_RIGHT 35
#define IR_OBSTACLE_STATE LOW // LOW = obstacle detected for most active-low IR modules

// Battery Voltage Monitoring (ADC1 GPIO 36 / VP)
#define BATTERY_PIN 36
const float BATTERY_DIVIDER_RATIO = 2.0; // 1:1 voltage divider (e.g. 2x 10k resistors)
const float BATTERY_FULL_V        = 8.4; // 2S Li-ion Full
const float BATTERY_EMPTY_V       = 6.4; // 2S Li-ion Cutoff

int getBatteryLevel(float &outVolts) {
  int raw = analogRead(BATTERY_PIN);
  float pinV = (raw / 4095.0f) * 3.3f;
  float batV = pinV * BATTERY_DIVIDER_RATIO;

  // Fallback to nominal 7.8V (85%) if ADC pin is not yet wired / floating low
  if (raw < 50) {
    batV = 7.8f;
  }

  outVolts = batV;
  int pct = (int)(((batV - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100.0f);
  return constrain(pct, 0, 100);
}

// ============================================================================
// PWM & MOTOR TIMINGS
// ============================================================================
const int PWM_FREQ = 1000;
const int PWM_RES  = 8; // 8-bit = 0-255

// Speed Presets
volatile int currentSpeed = 180;
const int TURN_SPEED = 170;
const int SAFE_DISTANCE_CM = 20;

// Autonomous Timings (ms)
const int IR_BACKWARD_TIME      = 250;
const int IR_TURN_TIME          = 400;
const int BOTH_IR_BACKWARD_TIME = 400;
const int BOTH_IR_TURN_TIME     = 400;
const int ULTRASONIC_TURN_TIME  = 450;

// Safety failsafe timeout for manual mode
#define FAILSAFE_TIMEOUT_MS 600

// ============================================================================
// SENSOR ENABLE/DISABLE REGISTRY
// ============================================================================
bool enableUltrasonic = true;
bool enableServo      = true;
bool enableIrLeft     = true;
bool enableIrRight    = true;

// ============================================================================
// BLE DEFINITIONS
// ============================================================================
#define DEVICE_NAME             "ESP32-RC-CAR"
#define SERVICE_UUID            "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Servo Object & Positions
Servo scanServo;
const int SERVO_CENTER = 90;
const int SERVO_LEFT   = 150;
const int SERVO_RIGHT  = 30;
int currentServoAngle  = SERVO_CENTER;

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

// Forward Declarations
void stopMotors();
void setSpeeds(int leftSpeed, int rightSpeed);
void moveForward();
void moveBackward();
void turnLeft();
void turnRight();
void decideDirectionAndTurn();
long getDistanceCM();

// ============================================================================
// MOTOR CONTROL PRIMITIVES
// ============================================================================

void setSpeeds(int leftSpeed, int rightSpeed) {
  leftSpeed = constrain(leftSpeed, 0, 255);
  rightSpeed = constrain(rightSpeed, 0, 255);

  // ESP32 Core 3.x uses pin directly for ledcWrite
  ledcWrite(ENA, leftSpeed);
  ledcWrite(ENB, rightSpeed);
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
// ULTRASONIC DISTANCE SENSOR
// ============================================================================

long getDistanceCM() {
  if (!enableUltrasonic) return -1;

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000); // 25ms timeout (~400cm)
  if (duration == 0) {
    return -1;
  }
  return (long)(duration * 0.0343 / 2);
}

// ============================================================================
// ULTRASONIC & SERVO DECISION LOGIC (Look Left, Look Right)
// ============================================================================

void decideDirectionAndTurn() {
  if (!enableServo || !enableUltrasonic) {
    // If scanning disabled, default turn right
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
  delay(350);
  leftDist = getDistanceCM();

  // 2. Look RIGHT
  scanServo.write(SERVO_RIGHT);
  currentServoAngle = SERVO_RIGHT;
  delay(500);
  rightDist = getDistanceCM();

  // 3. Return to CENTER
  scanServo.write(SERVO_CENTER);
  currentServoAngle = SERVO_CENTER;
  delay(300);

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
  delay(20);
}

// ============================================================================
// WI-FI & BLE NOTIFICATION ROUTINES
// ============================================================================

void notifyBle(const String& msg) {
  if (deviceConnected && pTxCharacteristic) {
    pTxCharacteristic->setValue(msg.c_str());
    pTxCharacteristic->notify();
  }
}

void scanWifiNetworks() {
  if (!wifiRadioEnabled) {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(50);
    wifiRadioEnabled = true;
  }
  Serial.println("[WIFI] Scanning 2.4GHz networks...");
  int n = WiFi.scanNetworks(false, true);
  String resp = "WIFI_SCAN:" + String(n) + ":";
  for (int i = 0; i < n && i < 12; ++i) {
    if (i > 0) resp += "|";
    bool enc = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
    resp += WiFi.SSID(i) + "," + String(WiFi.RSSI(i)) + "," + (enc ? "1" : "0");
  }
  WiFi.scanDelete();
  notifyBle(resp);
  Serial.printf("[WIFI] Scan finished: %d networks found\n", n);
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
// MOTION & BLUETOOTH COMMAND HANDLER
// ============================================================================

void processCommand(const String& cmd) {
  if (cmd.length() == 0) return;

  lastCommandTimestamp = millis();
  char c = cmd.charAt(0);

  // 0. Wi-Fi Control Commands (e.g. "WIFI:SCAN", "WIFI:CONN:SSID:PASS", "WIFI:OFF")
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
        notifyBle("WIFI_STATUS:CONNECTED:" + WiFi.localIP().toString() + ":" + String(WiFi.RSSI()) + ":" + WiFi.SSID());
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

  // 4. Mode Selection Commands
  if (c == 'A') {
    currentMode = MODE_AUTO_AVOID;
    scanServo.write(SERVO_CENTER);
    currentServoAngle = SERVO_CENTER;
    Serial.println("[MODE] Engaged: AUTOMATIC (Obstacle Avoidance)");
    return;
  }
  if (c == 'a') {
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

  // 5. Throttle / Speed Command (e.g. "V200")
  if (c == 'V') {
    int val = cmd.substring(1).toInt();
    currentSpeed = constrain(val, 50, 255);
    Serial.printf("[CONFIG] Speed set to: %d\n", currentSpeed);
    return;
  }

  // 6. Differential Tank Drive (e.g. "D:180,-180")
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

  // 7. Directional Motion Commands (Manual Touch Inputs)
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

      // Latency echo acknowledgment
      if (deviceConnected && pTxCharacteristic) {
        String ack = "ACK:" + rxValue;
        pTxCharacteristic->setValue(ack.c_str());
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
  delay(100);

  Serial.println();
  Serial.println("==========================================");
  Serial.println(" ESP32 BLE Obstacle-Avoiding RC Car");
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

  // 4. IR sensors (Input-only pins GPIO34 & GPIO35)
  pinMode(IR_LEFT, INPUT);
  pinMode(IR_RIGHT, INPUT);

  // 5. SG90 Servo Configuration (Allocate timers for Core 3.x compatibility)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  scanServo.setPeriodHertz(50);
  scanServo.attach(SERVO_PIN, 500, 2400);

  // Immediate Startup Sweep Test (Left -> Right -> Center)
  Serial.println("[SERVO] Testing sweep: LEFT -> RIGHT -> CENTER...");
  scanServo.write(SERVO_LEFT);
  delay(400);
  scanServo.write(SERVO_RIGHT);
  delay(600);
  scanServo.write(SERVO_CENTER);
  delay(350);
  Serial.println("[SERVO] Sweep test complete.");

  // 6. Stop Motors initially
  stopMotors();

  // 7. Initialize BLE Stack
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
  BLEDevice::startAdvertising();

  // 8. Start with Wi-Fi Radio OFF (Battery Saver Mode)
  WiFi.mode(WIFI_OFF);

  Serial.println("[READY] BLE Advertising active. Ready for PWA pairing.");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  unsigned long currentMillis = millis();

  // 0. Wi-Fi Connection State Monitor
  if (isConnectingWifi && wifiRadioEnabled) {
    if (WiFi.status() == WL_CONNECTED) {
      isConnectingWifi = false;
      activeConnectedSsid = WiFi.SSID();
      String ip = WiFi.localIP().toString();
      int rssi = WiFi.RSSI();
      notifyBle("WIFI_STATUS:CONNECTED:" + ip + ":" + String(rssi) + ":" + activeConnectedSsid);
      Serial.printf("[WIFI] Connected to %s! IP: %s (RSSI: %d dBm)\n", activeConnectedSsid.c_str(), ip.c_str(), rssi);
    } else if (currentMillis - wifiConnectStartTime > 12000) {
      isConnectingWifi = false;
      notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
      Serial.println("[WIFI] Connection timed out / failed.");
    }
  }

  // 1. Auto Re-Advertising on Client Disconnect
  if (!deviceConnected && oldDeviceConnected) {
    delay(200);
    pServer->startAdvertising();
    Serial.println("[BLE] Restarted advertising after disconnect.");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    lastCommandTimestamp = currentMillis;
    currentMode = MODE_MANUAL;
    Serial.println("[BLE] Client connected and synchronized!");
  }

  // 2. Mode Execution: Autonomous vs Manual
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

  // 3. Telemetry Stream to PWA (every 100ms when connected)
  if (deviceConnected && (currentMillis - lastTelemetryMillis >= 100)) {
    lastTelemetryMillis = currentMillis;
    unsigned long uptimeSec = currentMillis / 1000;

    // Read fast distance in manual mode if idle
    if (currentMode == MODE_MANUAL && lastCommandChar == 'S') {
      long d = enableUltrasonic ? getDistanceCM() : -1;
      if (d > 0) lastMeasuredCenterDist = d;
      lastLeftIrBlocked = enableIrLeft ? (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE) : false;
      lastRightIrBlocked = enableIrRight ? (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE) : false;
    }

    // Packet format: T:<uptime>,<center_dist_cm>,<ir_left>,<ir_right>,<servo_angle>,<battery_pct>,<battery_v>,<mode>
    char modeChar = (currentMode == MODE_AUTO_AVOID) ? 'A' : 'M';
    float batV = 7.8;
    int batPct = getBatteryLevel(batV);

    String telemetry = "T:" + String(uptimeSec) + "," +
                       String(lastMeasuredCenterDist) + "," +
                       String(lastLeftIrBlocked ? 1 : 0) + "," +
                       String(lastRightIrBlocked ? 1 : 0) + "," +
                       String(currentServoAngle) + "," +
                       String(batPct) + "," +
                       String(batV, 2) + "," +
                       String(modeChar);

    pTxCharacteristic->setValue(telemetry.c_str());
    pTxCharacteristic->notify();
  }

  delay(5);
}
