/**
 * ============================================================================
 * Project: ESP32 BLE RC & Autonomous Obstacle-Avoiding Robot (esp32_car)
 * Firmware: 1.0.8
 *
 * Changes vs 1.0.7
 *   - WebSocket Cloud Relay support with session code handshaking.
 *   - Default OTA URL pointed to custom production endpoint.
 *   - Optimized NVS session storage and cleaned legacy URLs.
 *   - OTA is now reboot-then-flash. The BLE command only sets a flag; loop()
 *     validates Wi-Fi/DNS, stores the request in NVS, sends OTA_READY and
 *     reboots. On the next boot, BEFORE BLE starts, the car rejoins Wi-Fi (same
 *     IP), serves the port-81 WebSocket for live progress and flashes with
 *     nearly all heap free (BLE + TLS together do not fit on a WROOM).
 *   - Failure reasons are stored and reported over BLE after the reboot.
 *   - Extra OTA diagnostics (URL, heap, TLS lastError) and one connect retry.
 *   - DIAG command returns heap, max block and version.
 *   - Plain-HTTP OTA URLs are supported (for a local test server).
 *   - Removed the useless HTTP fallback and the HTTPClient/WiFiServer includes.
 *   - Loop task stack raised to 16 KB (TLS needs it).
 *   - WebSocket server: buffered handshake, ping/pong, 127-length guard,
 *     payload cap, restart after Wi-Fi off/on.
 *   - Wi-Fi: WIFI:CONNB (base64 ssid/pass) and WIFI_NETB for ':' in names.
 *   - Battery uses analogReadMilliVolts() (factory calibrated).
 *   - Motor pins forced LOW at the very start of setup().
 *   - Auto-mode delays replaced by waitMs() so a manual command can interrupt.
 *   - Malformed E:/D:/P: commands no longer fall through to stop.
 *   - setMaxPreferred typo fixed, version banner uses FIRMWARE_VERSION.
 *
 * Build settings (Arduino IDE):
 *   Partition Scheme : Minimal SPIFFS (1.9MB APP with OTA / 190KB SPIFFS)
 *   Core Debug Level : None
 *   Upload the app-only file (Sketch -> Export Compiled Binary -> *.ino.bin)
 *
 * Hardware:
 *   ESP32 WROOM (Core 3.x), L298N, SG90, HC-SR04, 2x IR sensors
 * ============================================================================
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <mbedtls/sha1.h>
#include <mbedtls/base64.h>

// More stack for the Arduino loop task (TLS handshake during OTA)
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

// Firmware Version & OTA Configuration
static const char FIRMWARE_VERSION[] = "1.0.8";
static const char DEFAULT_OTA_URL[]  = "https://rc.codeblaze.in/firmware/esp32/latest/firmware.bin";

// Non-Volatile Storage (NVS) for Wi-Fi credential persistence
Preferences wifiPrefs;

// Direct LAN WebSocket server (port 81)
WiFiServer wsServer(81);
WiFiClient wsClient;
bool wsClientConnected = false;
bool wsServerActive = false;

static const size_t WS_MAX_PAYLOAD = 200;      // incoming text frames
static const size_t WS_MAX_SEND    = 125;      // outgoing frames (2-byte header)
static char wsHsBuf[768];                      // handshake buffer
static size_t wsHsLen = 0;
static unsigned long wsHsStart = 0;

// OTA state
volatile bool otaRequested = false;
bool otaInProgress = false;
String otaRequestUrl = "";
String otaSessionCode = "";

// Forward declarations
void processCommand(const String& cmd);
void handleWsClient();

// Wi-Fi power & connection state (default OFF to maximize battery life)
bool wifiRadioEnabled = false;
String activeConnectedSsid = "";
String targetConnectingSsid = "";
String targetConnectingPass = "";
unsigned long wifiConnectStartTime = 0;
bool isConnectingWifi = false;
bool isScanningWifiActive = false;
unsigned long wifiScanStartTime = 0;

// Wi-Fi async scan result queue
int scanResultCount = 0;
int currentScanDispatchIndex = 0;
unsigned long lastScanDispatchMillis = 0;

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================

// L298N dual motor driver
#define ENA 14
#define IN1 27
#define IN2 26
#define ENB 25
#define IN3 33
#define IN4 32

// Input sensors
#define BATTERY_PIN 36  // ADC1 GPIO 36 (VP), 20k:10k divider (ratio 3.0)
#define IR_LEFT     34
#define IR_RIGHT    35
#define IR_OBSTACLE_STATE LOW

// Ultrasonic + servo
#define SERVO_PIN 5
#define TRIG_PIN  18
#define ECHO_PIN  19    // via voltage divider

// Lights, horn, status
#define HEADLIGHT_LEFT_PIN  22
#define HEADLIGHT_RIGHT_PIN 23
#define BUZZER_PIN          21
#define STATUS_LED_PIN      2

bool isHeadlightsOn = false;

// 2S Li-ion battery monitor (2S nominal: 7.4V, min cutoff: 6.4V, max: 8.4V)
static const float BATTERY_DIVIDER_RATIO = 3.0f;
static const float BATTERY_FULL_V        = 8.4f;
static const float BATTERY_EMPTY_V       = 6.4f;
static const float BATTERY_MIN_REAL_V    = 5.5f; // Real 2S battery is > 5.5V. Below this is floating ADC noise / USB 5V powered.
static const float BATTERY_UNWIRED_PIN_MV = (BATTERY_MIN_REAL_V / BATTERY_DIVIDER_RATIO) * 1000.0f; // ~1833 mV
static float smoothedBatteryVolts = 0.0f;

int getBatteryLevel(float &outVolts) {
  uint32_t mvSum = 0;
  for (int i = 0; i < 8; i++) mvSum += analogReadMilliVolts(BATTERY_PIN);
  float pinMv = mvSum / 8.0f;

  // If measured voltage is below 5.5V battery equivalent, the ADC is unwired/floating
  if (pinMv < BATTERY_UNWIRED_PIN_MV) {
    outVolts = 0.0f;
    smoothedBatteryVolts = 0.0f;
    return -1; // Reports "NO BATTERY / USB POWERED" to UI
  }

  float instantBatV = (pinMv / 1000.0f) * BATTERY_DIVIDER_RATIO;
  if (smoothedBatteryVolts < 5.0f) smoothedBatteryVolts = instantBatV; // re-seed after unwired
  smoothedBatteryVolts = (smoothedBatteryVolts * 0.90f) + (instantBatV * 0.10f);
  outVolts = smoothedBatteryVolts;

  float pctFloat = ((smoothedBatteryVolts - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100.0f;
  return (int)constrain(pctFloat, 0.0f, 100.0f);
}

// ============================================================================
// PWM & MOTOR TIMINGS
// ============================================================================
static const int PWM_FREQ = 1000;
static const int PWM_RES  = 8;

volatile int currentSpeed = 180;
static const int TURN_SPEED = 170;
static const int SAFE_DISTANCE_CM = 20;

static const int IR_BACKWARD_TIME      = 250;
static const int IR_TURN_TIME          = 400;
static const int BOTH_IR_BACKWARD_TIME = 400;
static const int BOTH_IR_TURN_TIME     = 400;
static const int ULTRASONIC_TURN_TIME  = 450;

#define FAILSAFE_TIMEOUT_MS 600

// ============================================================================
// SENSOR ENABLE/DISABLE REGISTRY
// ============================================================================
bool enableUltrasonic = true;
bool enableServo      = true;
bool enableIrLeft     = false;
bool enableIrRight    = false;

// ============================================================================
// BLE DEFINITIONS
// ============================================================================
#define DEVICE_NAME             "ESP32-RC-CAR"
#define SERVICE_UUID            "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

Servo scanServo;
static const int SERVO_CENTER = 90;
static const int SERVO_LEFT   = 150;
static const int SERVO_RIGHT  = 30;
int currentServoAngle         = SERVO_CENTER;

enum DriveMode {
  MODE_MANUAL = 0,
  MODE_AUTO_AVOID = 1,
  MODE_AUTO_PATROL = 2
};

volatile DriveMode currentMode = MODE_MANUAL;

BLEServer* pServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
volatile bool deviceConnected = false;
bool oldDeviceConnected = false;

volatile unsigned long lastCommandTimestamp = 0;
volatile char lastCommandChar = 'S';
unsigned long lastTelemetryMillis = 0;
long lastMeasuredCenterDist = 100;
bool lastLeftIrBlocked = false;
bool lastRightIrBlocked = false;

static int cachedLeftSpeed = -1;
static int cachedRightSpeed = -1;

// Forward declarations
void stopMotors();
void setSpeeds(int leftSpeed, int rightSpeed);
void moveForward();
void moveBackward();
void turnLeft();
void turnRight();
void decideDirectionAndTurn(bool abortable = false);
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
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed, currentSpeed);
}

void moveBackward() {
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed, currentSpeed);
}

void turnLeft() {
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  setSpeeds(TURN_SPEED, TURN_SPEED);
}

void turnRight() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH);
  setSpeeds(TURN_SPEED, TURN_SPEED);
}

void forwardLeft() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed / 2, currentSpeed);
}

void forwardRight() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  setSpeeds(currentSpeed, currentSpeed / 2);
}

void reverseLeft() {
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed / 2, currentSpeed);
}

void reverseRight() {
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  setSpeeds(currentSpeed, currentSpeed / 2);
}

void stopMotors() {
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  setSpeeds(0, 0);
}

// Differential / tank drive: left, right in -255..+255
void setDifferential(int left, int right) {
  left = constrain(left, -255, 255);
  right = constrain(right, -255, 255);

  if (left > 0)      { digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW); }
  else if (left < 0) { digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH); }
  else               { digitalWrite(IN1, LOW);  digitalWrite(IN2, LOW); }

  if (right > 0)      { digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW); }
  else if (right < 0) { digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH); }
  else                { digitalWrite(IN3, LOW);  digitalWrite(IN4, LOW); }

  setSpeeds(abs(left), abs(right));
}

// ============================================================================
// STATUS LED, HEADLIGHTS & HORN
// ============================================================================

unsigned long lastStatusLedBlinkMillis = 0;
bool statusLedBlinkState = false;
static const unsigned long STATUS_LED_BLINK_INTERVAL_MS = 350;

void updateStatusLed() {
  if (deviceConnected || wsClientConnected) {
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else {
    unsigned long now = millis();
    if (now - lastStatusLedBlinkMillis >= STATUS_LED_BLINK_INTERVAL_MS) {
      lastStatusLedBlinkMillis = now;
      statusLedBlinkState = !statusLedBlinkState;
      digitalWrite(STATUS_LED_PIN, statusLedBlinkState ? HIGH : LOW);
    }
  }
}

void setHeadlights(bool on) {
  isHeadlightsOn = on;
  digitalWrite(HEADLIGHT_LEFT_PIN, on ? HIGH : LOW);
  digitalWrite(HEADLIGHT_RIGHT_PIN, on ? HIGH : LOW);
  Serial.printf("[LIGHTS] Dual Headlights: %s\n", on ? "ON" : "OFF");
}

void setHorn(bool on) {
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  Serial.printf("[HORN] Buzzer: %s\n", on ? "ON" : "OFF");
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

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 18000);
  if (duration == 0) return -1;
  return (long)(duration * 0.0343f / 2.0f);
}

// ============================================================================
// INTERRUPTIBLE WAIT (keeps the WebSocket serviced, aborts on mode change)
// ============================================================================

// Returns false if 'abortable' and the mode is no longer AUTO (a manual command arrived).
static bool waitMs(unsigned long ms, bool abortable) {
  unsigned long t = millis();
  while (millis() - t < ms) {
    handleWsClient();
    if (abortable && currentMode != MODE_AUTO_AVOID) return false;
    delay(2);
  }
  return true;
}

// ============================================================================
// ULTRASONIC & SERVO DECISION LOGIC
// ============================================================================

void decideDirectionAndTurn(bool abortable) {
  if (!enableServo || !enableUltrasonic) {
    turnRight();
    if (!waitMs(ULTRASONIC_TURN_TIME, abortable)) return;
    stopMotors();
    return;
  }

  long leftDist;
  long rightDist;

  scanServo.write(SERVO_LEFT);
  currentServoAngle = SERVO_LEFT;
  if (!waitMs(280, abortable)) { scanServo.write(SERVO_CENTER); currentServoAngle = SERVO_CENTER; return; }
  leftDist = getDistanceCM();

  scanServo.write(SERVO_RIGHT);
  currentServoAngle = SERVO_RIGHT;
  if (!waitMs(380, abortable)) { scanServo.write(SERVO_CENTER); currentServoAngle = SERVO_CENTER; return; }
  rightDist = getDistanceCM();

  scanServo.write(SERVO_CENTER);
  currentServoAngle = SERVO_CENTER;
  if (!waitMs(240, abortable)) return;

  if (leftDist < 0) leftDist = 400;
  if (rightDist < 0) rightDist = 400;

  Serial.printf("[AUTO SCAN] Left: %ld cm | Right: %ld cm\n", leftDist, rightDist);

  if (leftDist > rightDist) {
    Serial.println("[AUTO] Decision -> Turning LEFT");
    turnLeft();
  } else {
    Serial.println("[AUTO] Decision -> Turning RIGHT");
    turnRight();
  }
  if (!waitMs(ULTRASONIC_TURN_TIME, abortable)) return;

  stopMotors();
}

// ============================================================================
// AUTONOMOUS ROUTINE (Priority: IR Dual -> IR Left -> IR Right -> Ultrasonic)
// ============================================================================

// Back up, then turn. Returns false if interrupted by a manual command.
static bool avoidManeuver(int backMs, bool turnToRight, int turnMs) {
  stopMotors();
  moveBackward();
  if (!waitMs(backMs, true)) return false;
  if (turnToRight) turnRight(); else turnLeft();
  if (!waitMs(turnMs, true)) return false;
  stopMotors();
  return true;
}

void runAutonomousObstacleAvoidance() {
  bool leftBlocked  = enableIrLeft ? (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE) : false;
  bool rightBlocked = enableIrRight ? (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE) : false;
  lastLeftIrBlocked = leftBlocked;
  lastRightIrBlocked = rightBlocked;

  long distanceCenter = enableUltrasonic ? getDistanceCM() : -1;
  if (distanceCenter > 0) lastMeasuredCenterDist = distanceCenter;

  if (leftBlocked && rightBlocked) {
    Serial.println("[AUTO] Both IR sensors blocked!");
    avoidManeuver(BOTH_IR_BACKWARD_TIME, true, BOTH_IR_TURN_TIME);
    return;
  }

  if (leftBlocked) {
    Serial.println("[AUTO] Left IR blocked!");
    avoidManeuver(IR_BACKWARD_TIME, true, IR_TURN_TIME);
    return;
  }

  if (rightBlocked) {
    Serial.println("[AUTO] Right IR blocked!");
    avoidManeuver(IR_BACKWARD_TIME, false, IR_TURN_TIME);
    return;
  }

  if (enableUltrasonic && distanceCenter > 0 && distanceCenter < SAFE_DISTANCE_CM) {
    Serial.println("[AUTO] Ultrasonic obstacle detected!");
    stopMotors();
    decideDirectionAndTurn(true);
    return;
  }

  moveForward();
  delay(15);
}

// ============================================================================
// BASE64 HELPERS (for ':' and other special characters in Wi-Fi names)
// ============================================================================

static bool b64Decode(const String& in, String& out) {
  unsigned char buf[100];
  size_t olen = 0;
  int r = mbedtls_base64_decode(buf, sizeof(buf) - 1, &olen,
                                (const unsigned char*)in.c_str(), in.length());
  if (r != 0) return false;
  buf[olen] = '\0';
  out = String((char*)buf);
  return true;
}

static String b64Encode(const String& in) {
  unsigned char buf[100];
  size_t olen = 0;
  if (in.length() > 60) return String("");
  int r = mbedtls_base64_encode(buf, sizeof(buf) - 1, &olen,
                                (const unsigned char*)in.c_str(), in.length());
  if (r != 0) return String("");
  buf[olen] = '\0';
  return String((char*)buf);
}

// ============================================================================
// WEBSOCKET SERVER (RFC 6455, minimal, single client)
// ============================================================================

String computeWebSocketAccept(const String& key) {
  String combined = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  unsigned char sha1Result[20];

  mbedtls_sha1_context ctx;
  mbedtls_sha1_init(&ctx);
  mbedtls_sha1_starts(&ctx);
  mbedtls_sha1_update(&ctx, (const unsigned char*)combined.c_str(), combined.length());
  mbedtls_sha1_finish(&ctx, sha1Result);
  mbedtls_sha1_free(&ctx);

  unsigned char base64Result[36];
  size_t olen = 0;
  mbedtls_base64_encode(base64Result, sizeof(base64Result) - 1, &olen, sha1Result, 20);
  base64Result[olen] = '\0';
  return String((char*)base64Result);
}

// Send one frame with payload up to WS_MAX_SEND bytes (2-byte header).
static void sendWsFrame(uint8_t firstByte, const uint8_t* data, size_t len) {
  if (!wsClientConnected || !wsClient || !wsClient.connected()) {
    wsClientConnected = false;
    return;
  }
  if (len > WS_MAX_SEND) len = WS_MAX_SEND;
  uint8_t frame[2 + WS_MAX_SEND];
  frame[0] = firstByte;
  frame[1] = (uint8_t)len;
  if (len) memcpy(frame + 2, data, len);
  wsClient.write(frame, len + 2);   // single write, one TCP segment
}

void sendWs(const char* msg) {
  size_t len = strlen(msg);
  if (len == 0) return;
  sendWsFrame(0x81, (const uint8_t*)msg, len);   // FIN + text
}

void notifyBle(const char* msg) {
  if (deviceConnected && pTxCharacteristic) {
    pTxCharacteristic->setValue((uint8_t*)msg, strlen(msg));
    pTxCharacteristic->notify();
  }
  if (wsClientConnected && wsClient && wsClient.connected()) {
    sendWs(msg);
  }
}

void notifyBle(const String& msg) {
  notifyBle(msg.c_str());
}

static void wsDropClient(const char* why) {
  if (wsClient) wsClient.stop();
  wsClientConnected = false;
  wsHsLen = 0;
  Serial.printf("[WS] Client dropped: %s\n", why);
}

// Read exactly n bytes with a short timeout. Returns false on timeout/disconnect.
static bool wsReadBytes(uint8_t* dst, size_t n, unsigned long timeoutMs = 100) {
  unsigned long t = millis();
  size_t got = 0;
  while (got < n) {
    if (wsClient.available()) {
      int c = wsClient.read();
      if (c >= 0) dst[got++] = (uint8_t)c;
    } else {
      if (!wsClient.connected() || millis() - t > timeoutMs) return false;
      delay(1);
    }
  }
  return true;
}

// Handshake: collect bytes until the blank line, then answer with the accept key.
static void wsServiceHandshake() {
  while (wsClient.available() && wsHsLen < sizeof(wsHsBuf) - 1) {
    int c = wsClient.read();
    if (c < 0) break;
    wsHsBuf[wsHsLen++] = (char)c;
  }
  wsHsBuf[wsHsLen] = '\0';

  if (wsHsLen >= sizeof(wsHsBuf) - 1) { wsDropClient("handshake too large"); return; }
  if (millis() - wsHsStart > 2000)    { wsDropClient("handshake timeout"); return; }
  if (!strstr(wsHsBuf, "\r\n\r\n")) return;   // wait for more data

  // Find the key header (case-insensitive name)
  String req(wsHsBuf);
  String lower = req;
  lower.toLowerCase();
  int k = lower.indexOf("sec-websocket-key:");
  if (k < 0) { wsDropClient("no Sec-WebSocket-Key"); return; }
  int e = req.indexOf('\r', k);
  String key = req.substring(k + 18, e < 0 ? req.length() : e);
  key.trim();
  if (key.length() == 0) { wsDropClient("empty key"); return; }

  String resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                + computeWebSocketAccept(key) + "\r\n\r\n";
  wsClient.print(resp);
  wsClientConnected = true;
  wsHsLen = 0;
  Serial.println("[WS] Handshake OK, LAN client connected.");
  char verBuf[32];
  snprintf(verBuf, sizeof(verBuf), "FIRMWARE_VER:%s", FIRMWARE_VERSION);
  sendWs(verBuf);
}

// Read and handle one frame. Returns false if nothing was processed.
static bool wsServiceFrame() {
  if (wsClient.available() < 2) return false;

  uint8_t h[2];
  if (!wsReadBytes(h, 2)) { wsDropClient("short header"); return false; }
  uint8_t opcode = h[0] & 0x0F;
  bool isMasked  = (h[1] & 0x80) != 0;
  uint32_t payloadLen = h[1] & 0x7F;

  if (payloadLen == 126) {
    uint8_t ext[2];
    if (!wsReadBytes(ext, 2)) { wsDropClient("short ext length"); return false; }
    payloadLen = ((uint32_t)ext[0] << 8) | ext[1];
  } else if (payloadLen == 127) {
    wsDropClient("64-bit length not supported");
    return false;
  }

  uint8_t maskKey[4] = {0, 0, 0, 0};
  if (isMasked && !wsReadBytes(maskKey, 4)) { wsDropClient("short mask"); return false; }

  if (payloadLen > WS_MAX_PAYLOAD) { wsDropClient("payload too large"); return false; }

  uint8_t payload[WS_MAX_PAYLOAD + 1];
  if (payloadLen > 0 && !wsReadBytes(payload, payloadLen, 200)) {
    wsDropClient("short payload");
    return false;
  }
  if (isMasked) {
    for (uint32_t i = 0; i < payloadLen; i++) payload[i] ^= maskKey[i & 3];
  }
  payload[payloadLen] = '\0';

  switch (opcode) {
    case 0x1: {   // text
      String cmd((char*)payload);
      cmd.trim();
      if (cmd.length() > 0) processCommand(cmd);
      break;
    }
    case 0x8:     // close
      wsDropClient("close frame");
      return false;
    case 0x9:     // ping -> pong with same payload
      sendWsFrame(0x8A, payload, payloadLen > WS_MAX_SEND ? WS_MAX_SEND : payloadLen);
      break;
    default:      // pong, binary, continuation: ignored (already drained)
      break;
  }
  return true;
}

void handleWsClient() {
  if (!wifiRadioEnabled || WiFi.status() != WL_CONNECTED || !wsServerActive) return;

  if (wsServer.hasClient()) {
    if (wsClient && wsClient.connected()) wsClient.stop();
    wsClient = wsServer.accept();
    wsClientConnected = false;
    wsHsLen = 0;
    wsHsStart = millis();
    Serial.println("[WS] New LAN client connecting on port 81...");
  }

  if (wsClient && wsClient.connected()) {
    if (!wsClientConnected) {
      wsServiceHandshake();
    } else {
      for (int i = 0; i < 4 && wsClientConnected; i++) {
        if (!wsServiceFrame()) break;
      }
    }
  } else if (wsClientConnected) {
    wsClientConnected = false;
    Serial.println("[WS] LAN client connection dropped.");
  }
}

static void stopWsServer() {
  if (wsClient) wsClient.stop();
  wsClientConnected = false;
  if (wsServerActive) {
    wsServer.end();
    wsServerActive = false;
  }
}

// ============================================================================
// WI-FI MANAGEMENT
// ============================================================================

void scanWifiNetworks() {
  if (!wifiRadioEnabled) {
    WiFi.mode(WIFI_STA);
    delay(50);
    wifiRadioEnabled = true;
  }
  Serial.println("[WIFI] Initiating async 2.4GHz network scan...");
  WiFi.scanDelete();
  WiFi.scanNetworks(true);
  isScanningWifiActive = true;
  wifiScanStartTime = millis();
  scanResultCount = 0;
  currentScanDispatchIndex = 0;
  notifyBle("WIFI_SCAN_START");
}

void saveWifiCredentials(const String& ssid, const String& pass) {
  if (ssid.length() == 0) return;
  wifiPrefs.begin("rc_wifi", false);
  wifiPrefs.putString("ssid", ssid);
  wifiPrefs.putString("pass", pass);
  wifiPrefs.end();
  Serial.printf("[NVS] Persisted WiFi credentials for '%s'\n", ssid.c_str());
}

void loadWifiCredentials(String& ssid, String& pass) {
  wifiPrefs.begin("rc_wifi", true);
  ssid = wifiPrefs.getString("ssid", "");
  pass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
}

void clearWifiCredentials() {
  wifiPrefs.begin("rc_wifi", false);
  wifiPrefs.clear();
  wifiPrefs.end();
  Serial.println("[NVS] Cleared stored WiFi credentials.");
}

void connectWifi(const String& ssid, const String& pass) {
  if (!wifiRadioEnabled) {
    WiFi.mode(WIFI_STA);
    wifiRadioEnabled = true;
  }
  Serial.printf("[WIFI] Connecting to SSID: %s\n", ssid.c_str());
  targetConnectingSsid = ssid;
  targetConnectingPass = pass;
  isConnectingWifi = true;
  wifiConnectStartTime = millis();

  if (pass.length() > 0) WiFi.begin(ssid.c_str(), pass.c_str());
  else                   WiFi.begin(ssid.c_str());
}

void autoConnectSavedWifi() {
  String savedSsid, savedPass;
  loadWifiCredentials(savedSsid, savedPass);
  if (savedSsid.length() > 0) {
    Serial.printf("[WIFI] Found saved network '%s'. Attempting auto-connect...\n", savedSsid.c_str());
    connectWifi(savedSsid, savedPass);
  } else {
    Serial.println("[WIFI] No saved network credentials found in NVS.");
    notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
  }
}

void disconnectWifi() {
  stopWsServer();
  WiFi.disconnect(true);
  activeConnectedSsid = "";
  isConnectingWifi = false;
  notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
  Serial.println("[WIFI] Disconnected from network.");
}

void turnWifiRadioOff() {
  stopWsServer();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiRadioEnabled = false;
  activeConnectedSsid = "";
  isConnectingWifi = false;
  notifyBle("WIFI_STATUS:OFF:0.0.0.0:0:");
  Serial.println("[WIFI] Radio POWERED OFF (Battery Saver Active)");
}

// ============================================================================
// OVER-THE-AIR (OTA) FIRMWARE UPDATE  (reboot-then-flash design)
//
//  Phase 1 (loop, BLE still up): check Wi-Fi + DNS, store the request in NVS,
//          send OTA_READY:<ip>:81 over BLE, reboot.
//  Phase 2 (setup, BEFORE BLE exists): reconnect Wi-Fi, start the port-81
//          WebSocket, wait for the app, download + flash with ~all heap free.
//  On failure the reason is saved to NVS, the car reboots into normal mode and
//  reports OTA_ERROR:<reason> over BLE as soon as the app reconnects.
// ============================================================================

static const char OTA_NS[] = "rc_ota";
String bootOtaError = "";   // error from the last failed boot-update, reported once over BLE

static String hostFromUrl(const String& url) {
  int s = url.indexOf("://");
  s = (s < 0) ? 0 : s + 3;
  int e = url.indexOf('/', s);
  String host = (e < 0) ? url.substring(s) : url.substring(s, e);
  int colon = host.indexOf(':');            // strip :port
  if (colon >= 0) host = host.substring(0, colon);
  return host;
}

static uint16_t portFromUrl(const String& url) {
  int s = url.indexOf("://");
  s = (s < 0) ? 0 : s + 3;
  int e = url.indexOf('/', s);
  String hostPart = (e < 0) ? url.substring(s) : url.substring(s, e);
  int colon = hostPart.indexOf(':');
  if (colon >= 0) {
    int p = hostPart.substring(colon + 1).toInt();
    if (p > 0 && p <= 65535) return (uint16_t)p;
  }
  return url.startsWith("https://") ? 443 : 80;
}

static void sanitizeOtaUrl(String& url, String& sessionCode) {
  url.trim();

  // If session code was attached via ":ota_..." or after ".bin:", split it cleanly
  int binColon = url.lastIndexOf(".bin:");
  if (binColon != -1) {
    if (sessionCode.length() == 0) {
      sessionCode = url.substring(binColon + 5);
    }
    url = url.substring(0, binColon + 4); // Keep ".bin"
  } else {
    int otaColon = url.lastIndexOf(":ota_");
    if (otaColon != -1) {
      if (sessionCode.length() == 0) {
        sessionCode = url.substring(otaColon + 1);
      }
      url = url.substring(0, otaColon);
    }
  }

  // Automatic HTTPS upgrade:
  // If host is rc.codeblaze.in (production domain LiteSpeed web server enforces HTTPS 301 redirect),
  // upgrade to https:// so ESP uses WiFiClientSecure directly without failing on 301!
  if (url.startsWith("http://rc.codeblaze.in") || url.startsWith("http://www.rc.codeblaze.in")) {
    url = "https://" + url.substring(7);
  }
}

// Pure RFC 6455 Client-to-Server Masked WebSocket Frame Sender
static void sendWsClientFrame(WiFiClient& client, const String& payload) {
  if (!client.connected()) return;
  size_t len = payload.length();
  uint8_t mask[4] = { 0x4A, 0x9B, 0x2C, 0x7E };
  uint8_t header[14];
  size_t headerLen = 0;
  header[0] = 0x81; // FIN + Text frame (0x01)

  if (len < 126) {
    header[1] = 0x80 | (uint8_t)len; // MASK bit set
    headerLen = 2;
  } else if (len < 65536) {
    header[1] = 0x80 | 126;
    header[2] = (len >> 8) & 0xFF;
    header[3] = len & 0xFF;
    headerLen = 4;
  } else {
    header[1] = 0x80 | 127;
    for (int i = 0; i < 6; i++) header[2 + i] = 0;
    header[8] = (len >> 8) & 0xFF;
    header[9] = len & 0xFF;
    headerLen = 10;
  }
  memcpy(&header[headerLen], mask, 4);
  headerLen += 4;
  client.write(header, headerLen);

  uint8_t maskedBuf[256];
  for (size_t i = 0; i < len; i += 256) {
    size_t chunk = (len - i < 256) ? (len - i) : 256;
    for (size_t j = 0; j < chunk; j++) {
      maskedBuf[j] = ((uint8_t)payload[i + j]) ^ mask[(i + j) % 4];
    }
    client.write(maskedBuf, chunk);
  }
}

static void saveOtaError(const String& msg) {
  Preferences p;
  p.begin(OTA_NS, false);
  p.putString("err", msg);
  p.end();
}

static String takeOtaError() {
  Preferences p;
  p.begin(OTA_NS, false);
  String e = p.getString("err", "");
  if (e.length()) p.remove("err");
  p.end();
  return e;
}

// ---- Phase 1 ---------------------------------------------------------------

// Called from loop() when the app asked for an update. Returns only if the
// pre-checks fail (BLE stays up and the app gets OTA_ERROR). Otherwise reboots.
void prepareBootOta() {
  String url = otaRequestUrl.length() ? otaRequestUrl : String(DEFAULT_OTA_URL);
  String sess = otaSessionCode;
  sanitizeOtaUrl(url, sess);
  Serial.printf("[OTA] Requested URL: %s\n", url.c_str());
  Serial.printf("[OTA] Session Code:  %s\n", sess.c_str());
  Serial.printf("[OTA] Heap now: %u, max block: %u\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    notifyBle("OTA_ERROR:Bad URL");
    return;
  }
  if (!wifiRadioEnabled || WiFi.status() != WL_CONNECTED) {
    notifyBle("OTA_ERROR:Wi-Fi not connected");
    return;
  }
  IPAddress resolved;
  if (!WiFi.hostByName(hostFromUrl(url).c_str(), resolved)) {
    notifyBle("OTA_ERROR:No internet / DNS failed");
    return;
  }

  // Remember the network settings and session code so the car comes back on the SAME IP
  Preferences p;
  p.begin(OTA_NS, false);
  p.putString("url", url);
  p.putString("sess", sess);
  p.putUInt("ip",   (uint32_t)WiFi.localIP());
  p.putUInt("gw",   (uint32_t)WiFi.gatewayIP());
  p.putUInt("mask", (uint32_t)WiFi.subnetMask());
  p.putUInt("dns",  (uint32_t)WiFi.dnsIP());
  p.putBool("pending", true);
  p.end();

  char ready[64];
  snprintf(ready, sizeof(ready), "OTA_READY:%s:81", WiFi.localIP().toString().c_str());
  notifyBle(ready);
  Serial.println("[OTA] Request stored. Rebooting into update mode...");
  stopMotors();
  currentMode = MODE_MANUAL;
  delay(700);       // let the BLE notification go out
  ESP.restart();
}

// ---- Phase 2 ---------------------------------------------------------------

static void otaFail(const String& msg) {
  Serial.printf("[OTA] FAILED: %s\n", msg.c_str());
  saveOtaError(msg);
  notifyBle("OTA_ERROR:" + msg);   // only the WebSocket exists at this point
  delay(1500);                     // let the frame go out
  ESP.restart();                   // back to normal mode with BLE
}

static bool bootWifiConnect(const String& ssid, const String& pass, bool tryStatic,
                            IPAddress ip, IPAddress gw, IPAddress mask, IPAddress dns) {
  for (int attempt = 0; attempt < 2; attempt++) {
    if (attempt == 1 && !tryStatic) break;     // nothing different to try
    bool useStatic = tryStatic && attempt == 0;

    if (attempt > 0) { WiFi.disconnect(true); delay(200); }
    WiFi.mode(WIFI_STA);
    if (useStatic) WiFi.config(ip, gw, mask, dns);
    else           WiFi.config(IPAddress(0, 0, 0, 0), IPAddress(0, 0, 0, 0), IPAddress(0, 0, 0, 0));

    if (pass.length() > 0) WiFi.begin(ssid.c_str(), pass.c_str());
    else                   WiFi.begin(ssid.c_str());

    Serial.printf("[OTA] Wi-Fi attempt %d (%s)...\n", attempt + 1, useStatic ? "same IP" : "DHCP");
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 12000) {
      updateStatusLed();
      delay(100);
    }
    if (WiFi.status() == WL_CONNECTED) return true;
  }
  return false;
}

// Called from setup() before BLE is initialised. Does nothing unless a request is pending.
void runBootOtaIfPending() {
  Preferences p;
  p.begin(OTA_NS, false);
  bool pending = p.getBool("pending", false);
  if (!pending) { p.end(); return; }

  String url = p.getString("url", "");
  String sessionCode = p.getString("sess", "");
  sanitizeOtaUrl(url, sessionCode);
  IPAddress ip((uint32_t)p.getUInt("ip", 0));
  IPAddress gw((uint32_t)p.getUInt("gw", 0));
  IPAddress mask((uint32_t)p.getUInt("mask", 0));
  IPAddress dns((uint32_t)p.getUInt("dns", 0));
  p.putBool("pending", false);     // clear FIRST so a crash can never boot-loop
  p.end();

  otaInProgress = true;
  Serial.println("[OTA] ===== BOOT UPDATE MODE =====");
  Serial.printf("[OTA] URL:         %s\n", url.c_str());
  Serial.printf("[OTA] SessionCode: %s\n", sessionCode.c_str());
  Serial.printf("[OTA] Heap: %u, max block: %u\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());

  if (url.length() == 0) { otaInProgress = false; saveOtaError("No URL stored"); return; }

  String ssid, pass;
  loadWifiCredentials(ssid, pass);
  if (ssid.length() == 0) { otaInProgress = false; saveOtaError("No saved Wi-Fi"); return; }

  bool haveStatic = (uint32_t)ip != 0 && (uint32_t)gw != 0 && (uint32_t)mask != 0;
  if (!bootWifiConnect(ssid, pass, haveStatic, ip, gw, mask, dns)) {
    otaInProgress = false;
    saveOtaError("Wi-Fi connect failed");
    WiFi.mode(WIFI_OFF);
    return;                        // continue normal boot, BLE comes up and reports the error
  }

  wifiRadioEnabled = true;
  activeConnectedSsid = WiFi.SSID();
  WiFi.setSleep(false);
  wsServer.begin();
  wsServerActive = true;
  Serial.printf("[OTA] Wi-Fi up. IP: %s  RSSI: %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());

  // Connect to Cloud WebSocket Relay (/ws) for targeted browser progress streaming
  WiFiClient otaCloudWs;
  bool cloudWsConnected = false;
  String host = hostFromUrl(url);
  uint16_t port = portFromUrl(url);

  if (host.length() > 0 && !url.startsWith("https://")) {
    Serial.printf("[OTA WS] Connecting to Cloud WebSocket Relay at %s:%u/ws...\n", host.c_str(), port);
    if (otaCloudWs.connect(host.c_str(), port, 4000)) {
      String handshake = "GET /ws HTTP/1.1\r\n"
                         "Host: " + host + ":" + String(port) + "\r\n"
                         "Upgrade: websocket\r\n"
                         "Connection: Upgrade\r\n"
                         "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                         "Sec-WebSocket-Version: 13\r\n\r\n";
      otaCloudWs.print(handshake);

      unsigned long tHs = millis();
      String response = "";
      while (millis() - tHs < 3000) {
        while (otaCloudWs.available()) {
          char c = (char)otaCloudWs.read();
          response += c;
          if (response.endsWith("\r\n\r\n")) break;
        }
        if (response.indexOf("101") != -1) {
          cloudWsConnected = true;
          break;
        }
        delay(10);
      }

      if (cloudWsConnected) {
        Serial.println("[OTA WS] Cloud WS Handshake OK! Registering ESP session...");
        if (sessionCode.length() > 0) {
          String regJson = "{\"type\":\"REGISTER_SESSION\",\"sessionCode\":\"" + sessionCode + "\",\"role\":\"esp32\"}";
          sendWsClientFrame(otaCloudWs, regJson);
          delay(40);
        }
        String startJson = "{\"type\":\"OTA_START\",\"sessionCode\":\"" + sessionCode + "\",\"message\":\"ESP32 connected! Downloading firmware...\"}";
        sendWsClientFrame(otaCloudWs, startJson);
      } else {
        Serial.println("[OTA WS] Cloud WS Handshake failed or non-101 response.");
      }
    } else {
      Serial.println("[OTA WS] Could not connect TCP to Cloud WS host.");
    }
  }

  notifyBle("OTA_PROGRESS:1:Connecting to firmware server...");

  httpUpdate.onProgress([&otaCloudWs, &sessionCode, &cloudWsConnected](int cur, int total) {
    static int last = -1;
    if (total <= 0) return;
    int pct = (int)(((int64_t)cur * 100) / total);
    if (pct != last && (pct % 2 == 0 || pct == 100)) {
      last = pct;
      if (cloudWsConnected && otaCloudWs.connected()) {
        String progJson = "{\"type\":\"OTA_PROGRESS\",\"sessionCode\":\"" + sessionCode + "\",\"pct\":" + String(pct) + ",\"bytesSent\":" + String(cur) + ",\"totalSize\":" + String(total) + ",\"status\":\"FLASHING\"}";
        sendWsClientFrame(otaCloudWs, progJson);
      }
      char b[64];
      snprintf(b, sizeof(b), "OTA_PROGRESS:%d:Writing firmware...", pct);
      notifyBle(b);
      Serial.printf("[OTA] Flash progress: %d%%\n", pct);
    }
    handleWsClient();
  });
  httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(false);

  bool useTls = url.startsWith("https://");
  t_httpUpdate_return ret = HTTP_UPDATE_FAILED;

  for (int attempt = 1; attempt <= 2; attempt++) {
    Serial.printf("[OTA] Connecting via %s to: %s\n", useTls ? "HTTPS" : "HTTP", url.c_str());
    if (useTls) {
      WiFiClientSecure client;
      client.setInsecure();          // SSL without strict root CA for seamless zero-config OTA
      client.setHandshakeTimeout(30);
      ret = httpUpdate.update(client, url);
      if (ret == HTTP_UPDATE_FAILED) {
        char eb[100] = {0};
        int e = client.lastError(eb, sizeof(eb));
        Serial.printf("[OTA] TLS lastError %d: %s\n", e, eb);
      }
    } else {
      WiFiClient client;             // plain HTTP
      ret = httpUpdate.update(client, url);
    }
    Serial.printf("[OTA] Attempt %d result %d. Heap: %u, max block: %u\n", attempt, (int)ret,
                  (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());

    if (ret == HTTP_UPDATE_OK) break;

    // If HTTP failed because of 301/302 redirect (Error -104 / Wrong HTTP Code), switch attempt 2 to HTTPS!
    if (!useTls && (httpUpdate.getLastError() == HTTP_UE_SERVER_WRONG_HTTP_CODE || httpUpdate.getLastError() == HTTPC_ERROR_CONNECTION_REFUSED || url.startsWith("http://"))) {
      Serial.println("[OTA] Plain HTTP returned wrong code (redirect). Switching attempt 2 to HTTPS...");
      url.replace("http://", "https://");
      useTls = true;
      delay(1000);
      continue;
    }

    if (ret != HTTP_UPDATE_FAILED || httpUpdate.getLastError() != HTTPC_ERROR_CONNECTION_REFUSED) break;
    if (attempt < 2) {
      notifyBle("OTA_PROGRESS:1:Retrying connection...");
      delay(2000);
    }
  }

  if (ret == HTTP_UPDATE_OK) {
    Serial.println("[OTA] Flash OK, rebooting into new firmware.");
    if (cloudWsConnected && otaCloudWs.connected()) {
      String compJson = "{\"type\":\"OTA_COMPLETE\",\"sessionCode\":\"" + sessionCode + "\",\"pct\":100,\"status\":\"REBOOTING\"}";
      sendWsClientFrame(otaCloudWs, compJson);
      delay(150);
    }
    notifyBle("OTA_COMPLETE:Rebooting...");
    delay(1500);
    ESP.restart();
  } else if (ret == HTTP_UPDATE_NO_UPDATES) {
    if (cloudWsConnected && otaCloudWs.connected()) {
      String errJson = "{\"type\":\"OTA_ERROR\",\"sessionCode\":\"" + sessionCode + "\",\"message\":\"Server returned no update\"}";
      sendWsClientFrame(otaCloudWs, errJson);
      delay(100);
    }
    otaFail("Server returned no update");
  } else {
    Serial.printf("[OTA] Error %d: %s\n", httpUpdate.getLastError(),
                  httpUpdate.getLastErrorString().c_str());
    if (cloudWsConnected && otaCloudWs.connected()) {
      String errJson = "{\"type\":\"OTA_ERROR\",\"sessionCode\":\"" + sessionCode + "\",\"message\":\"" + httpUpdate.getLastErrorString() + "\"}";
      sendWsClientFrame(otaCloudWs, errJson);
      delay(100);
    }
    otaFail(httpUpdate.getLastErrorString());
  }
}

// ============================================================================
// COMMAND HANDLER
// ============================================================================

void processCommand(const String& cmd) {
  if (cmd.length() == 0) return;
  if (otaInProgress) return;   // ignore everything while flashing

  lastCommandTimestamp = millis();
  char c = cmd.charAt(0);

  // OTA ("OTA:UPDATE", "OTA:UPDATE:<url>", "OTA:UPDATE:<url>:<sessionCode>", "OTA:VERSION"). Only sets a flag.
  if (cmd.startsWith("OTA:UPDATE")) {
    otaRequestUrl = "";
    otaSessionCode = "";
    if (cmd.length() > 10 && cmd.charAt(10) == ':') {
      String payload = cmd.substring(11);
      sanitizeOtaUrl(payload, otaSessionCode);
      otaRequestUrl = payload;
    }
    stopMotors();
    currentMode = MODE_MANUAL;
    otaRequested = true;   // handled in loop()
    return;
  }
  if (cmd == "DIAG") {
    char d[80];
    snprintf(d, sizeof(d), "DIAG:%u,%u,%s", (unsigned)ESP.getFreeHeap(),
             (unsigned)ESP.getMaxAllocHeap(), FIRMWARE_VERSION);
    notifyBle(d);
    return;
  }
  if (cmd == "OTA:VERSION" || cmd == "FIRMWARE:VERSION") {
    char verBuf[32];
    snprintf(verBuf, sizeof(verBuf), "FIRMWARE_VER:%s", FIRMWARE_VERSION);
    notifyBle(verBuf);
    return;
  }

  // Wi-Fi control ("WIFI:SCAN", "WIFI:CONN:SSID:PASS", "WIFI:CONNB:b64ssid:b64pass", ...)
  if (cmd.startsWith("WIFI:")) {
    String sub = cmd.substring(5);
    if (sub == "SCAN") {
      scanWifiNetworks();
    } else if (sub.startsWith("CONNB:")) {
      int sep = sub.indexOf(':', 6);
      String ssid, pass;
      bool ok = false;
      if (sep != -1) {
        ok = b64Decode(sub.substring(6, sep), ssid);
        String p;
        ok = ok && b64Decode(sub.substring(sep + 1), p);
        pass = p;
      } else {
        ok = b64Decode(sub.substring(6), ssid);
      }
      if (ok && ssid.length() > 0) connectWifi(ssid, pass);
      else notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
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
    } else if (sub == "AUTO" || sub == "AUTOCONN") {
      autoConnectSavedWifi();
    } else if (sub == "CLEAR") {
      clearWifiCredentials();
      disconnectWifi();
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

  // Sensor enable/disable ("E:US:0", "E:IRL:1")
  if (c == 'E' && cmd.length() > 1 && cmd.charAt(1) == ':') {
    int secondColon = cmd.indexOf(':', 2);
    if (secondColon != -1) {
      String sensorKey = cmd.substring(2, secondColon);
      bool state = cmd.substring(secondColon + 1).toInt() == 1;

      if (sensorKey == "US") {
        enableUltrasonic = state;
        Serial.printf("[SENSOR CONFIG] Ultrasonic: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "SRV") {
        enableServo = state;
        Serial.printf("[SENSOR CONFIG] Servo: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "IRL") {
        enableIrLeft = state;
        Serial.printf("[SENSOR CONFIG] Left IR: %s\n", state ? "ENABLED" : "DISABLED");
      } else if (sensorKey == "IRR") {
        enableIrRight = state;
        Serial.printf("[SENSOR CONFIG] Right IR: %s\n", state ? "ENABLED" : "DISABLED");
      }
    }
    return;   // malformed E: commands are ignored, not treated as 'stop'
  }

  // Servo manual angle ("P:90")
  if (c == 'P' && cmd.length() > 1 && cmd.charAt(1) == ':') {
    int angle = constrain(cmd.substring(2).toInt(), 0, 180);
    scanServo.write(angle);
    currentServoAngle = angle;
    Serial.printf("[SERVO] Manual angle set to %d deg\n", angle);
    return;
  }

  // Single ping
  if (cmd == "PING") {
    long d = getDistanceCM();
    if (d > 0) lastMeasuredCenterDist = d;
    Serial.printf("[TEST] Ping result: %ld cm\n", d);
    return;
  }

  // Mode selection ('X'/'A' = AUTO, 'M'/'a' = MANUAL)
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
  if (c == 'K') {   // manual servo sweep test
    Serial.println("[SERVO] Manual Scan Sweep Triggered from App");
    decideDirectionAndTurn(false);
    return;
  }

  // Headlights ('W' on, 'w' off)
  if (c == 'W') { setHeadlights(true);  return; }
  if (c == 'w') { setHeadlights(false); return; }

  // Horn ('U' on, 'u' off)
  if (c == 'U') { setHorn(true);  return; }
  if (c == 'u') { setHorn(false); return; }

  // Speed ("V200")
  if (c == 'V') {
    int val = cmd.substring(1).toInt();
    currentSpeed = constrain(val, 50, 255);
    Serial.printf("[CONFIG] Speed set to: %d\n", (int)currentSpeed);
    return;
  }

  // Differential tank drive ("D:180,-180")
  if (c == 'D' && cmd.length() > 1 && cmd.charAt(1) == ':') {
    int commaIdx = cmd.indexOf(',');
    if (commaIdx > 2) {
      currentMode = MODE_MANUAL;
      int leftPwr = cmd.substring(2, commaIdx).toInt();
      int rightPwr = cmd.substring(commaIdx + 1).toInt();
      setDifferential(leftPwr, rightPwr);
    }
    return;   // malformed D: commands are ignored
  }

  // Directional motion (manual touch inputs)
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
    if (!otaInProgress) {
      currentMode = MODE_MANUAL;
      stopMotors();
    }
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();

    if (rxValue.length() > 0) {
      processCommand(rxValue);   // OTA only sets a flag here, nothing heavy runs in this callback

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
  // 0. Safe pin state first: motors off before anything else runs
  pinMode(IN1, OUTPUT); digitalWrite(IN1, LOW);
  pinMode(IN2, OUTPUT); digitalWrite(IN2, LOW);
  pinMode(IN3, OUTPUT); digitalWrite(IN3, LOW);
  pinMode(IN4, OUTPUT); digitalWrite(IN4, LOW);
  pinMode(ENA, OUTPUT); digitalWrite(ENA, LOW);
  pinMode(ENB, OUTPUT); digitalWrite(ENB, LOW);

  Serial.begin(115200);
  delay(50);

  Serial.println();
  Serial.println("==========================================");
  Serial.printf(" ESP32 BLE Obstacle-Avoiding RC Car v%s\n", FIRMWARE_VERSION);
  Serial.println(" Hardware: L298N + SG90 Servo + HC-SR04 + 2x IR");
  Serial.println(" Core 3.x | Web Bluetooth Nordic UART");
  Serial.println("==========================================");

  // 1. PWM on ENA & ENB (Core 3.x)
  ledcAttach(ENA, PWM_FREQ, PWM_RES);
  ledcAttach(ENB, PWM_FREQ, PWM_RES);
  stopMotors();

  // 2. Ultrasonic pins (use INPUT_PULLDOWN to prevent floating noise when unwired)
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT_PULLDOWN);
  digitalWrite(TRIG_PIN, LOW);

  // 3. ADC & IR inputs
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(BATTERY_PIN, INPUT);
  pinMode(IR_LEFT, INPUT);
  pinMode(IR_RIGHT, INPUT);

  // 4. Status LED, headlights, buzzer
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  pinMode(HEADLIGHT_LEFT_PIN, OUTPUT);
  pinMode(HEADLIGHT_RIGHT_PIN, OUTPUT);
  setHeadlights(false);
  pinMode(BUZZER_PIN, OUTPUT);
  setHorn(false);

  // 4b. Pending OTA? Must run BEFORE BLE exists so TLS gets nearly all the heap.
  //     Reboots when done; returns only if the update could not even start.
  runBootOtaIfPending();
  bootOtaError = takeOtaError();   // reason a previous update failed (reported over BLE)

  // 5. Servo (after motor pins are safe)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  scanServo.setPeriodHertz(50);
  scanServo.attach(SERVO_PIN, 500, 2400);

  Serial.println("[SERVO] Testing sweep: LEFT -> RIGHT -> CENTER...");
  scanServo.write(SERVO_LEFT);
  delay(300);
  scanServo.write(SERVO_RIGHT);
  delay(450);
  scanServo.write(SERVO_CENTER);
  delay(250);
  Serial.println("[SERVO] Sweep test complete.");

  // 6. BLE
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  pService->start();

  // 6.1 Standard Device Information Service (DIS, UUID 0x180A)
  BLEService* pDis = pServer->createService(BLEUUID((uint16_t)0x180A));
  BLECharacteristic* c;
  c = pDis->createCharacteristic(BLEUUID((uint16_t)0x2A29), BLECharacteristic::PROPERTY_READ);
  c->setValue("ESP32 RC");                    // Manufacturer Name String
  c = pDis->createCharacteristic(BLEUUID((uint16_t)0x2A24), BLECharacteristic::PROPERTY_READ);
  c->setValue("ESP32-ROBOT-1");               // Model Number String
  c = pDis->createCharacteristic(BLEUUID((uint16_t)0x2A26), BLECharacteristic::PROPERTY_READ);
  c->setValue(FIRMWARE_VERSION);              // Firmware Revision String
  c = pDis->createCharacteristic(BLEUUID((uint16_t)0x2A28), BLECharacteristic::PROPERTY_READ);
  c->setValue("4.0.0");                       // Software Revision String
  pDis->start();

  // 6.2 Advertising with standard Remote Control Appearance
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->addServiceUUID(BLEUUID((uint16_t)0x180A));
  pAdvertising->setAppearance(0x0180); // Generic Remote Control (Bluetooth SIG standard)
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::setMTU(512);
  BLEDevice::startAdvertising();

  // 7. Wi-Fi OFF at boot (battery saver)
  WiFi.mode(WIFI_OFF);

  Serial.printf("[READY] BLE advertising. Heap: %u, max block: %u\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // -1. OTA request (flag set by processCommand). Never returns.
  if (otaRequested) {
    otaRequested = false;
    prepareBootOta();   // reboots on success; returns only if a pre-check failed (BLE stays up)
  }

  unsigned long currentMillis = millis();

  updateStatusLed();

  // 1. Non-blocking Wi-Fi scan result dispatcher
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

      if (currentMillis - lastScanDispatchMillis >= 25) {
        lastScanDispatchMillis = currentMillis;

        if (currentScanDispatchIndex < scanResultCount && currentScanDispatchIndex < 15) {
          String ssid = WiFi.SSID(currentScanDispatchIndex);
          if (ssid.length() > 0) {
            int rssi = WiFi.RSSI(currentScanDispatchIndex);
            bool enc = (WiFi.encryptionType(currentScanDispatchIndex) != WIFI_AUTH_OPEN);
            char netMsg[96];
            if (ssid.indexOf(':') >= 0) {
              // ':' would break the colon-delimited message, send the name as base64
              snprintf(netMsg, sizeof(netMsg), "WIFI_NETB:%s:%d:%d",
                       b64Encode(ssid).c_str(), rssi, enc ? 1 : 0);
            } else {
              snprintf(netMsg, sizeof(netMsg), "WIFI_NET:%s:%d:%d", ssid.c_str(), rssi, enc ? 1 : 0);
            }
            notifyBle(netMsg);
            Serial.printf("  [%d] %s (%d dBm)\n", currentScanDispatchIndex + 1, ssid.c_str(), rssi);
          }
          currentScanDispatchIndex++;
        } else {
          isScanningWifiActive = false;
          WiFi.scanDelete();
          notifyBle("WIFI_SCAN_END");
        }
      }
    } else if (scanResult == -2 || (currentMillis - wifiScanStartTime > 10000)) {
      isScanningWifiActive = false;
      WiFi.scanDelete();
      Serial.println("[WIFI] Scan failed or timed out.");
      notifyBle("WIFI_SCAN_END");
    }
  }

  // 2. Non-blocking Wi-Fi connection monitor
  if (isConnectingWifi && wifiRadioEnabled) {
    if (WiFi.status() == WL_CONNECTED) {
      isConnectingWifi = false;
      activeConnectedSsid = WiFi.SSID();
      saveWifiCredentials(activeConnectedSsid, targetConnectingPass);
      String ip = WiFi.localIP().toString();
      int rssi = WiFi.RSSI();
      char connBuf[96];
      snprintf(connBuf, sizeof(connBuf), "WIFI_STATUS:CONNECTED:%s:%d:%s", ip.c_str(), rssi, activeConnectedSsid.c_str());
      notifyBle(connBuf);
      Serial.printf("[WIFI] Connected to %s! IP: %s (RSSI: %d dBm)\n", activeConnectedSsid.c_str(), ip.c_str(), rssi);

      if (!wsServerActive) {
        wsServer.begin();
        wsServerActive = true;
        Serial.printf("[WS] LAN WebSocket server active: ws://%s:81\n", ip.c_str());
      }
    } else if (currentMillis - wifiConnectStartTime > 12000) {
      isConnectingWifi = false;
      notifyBle("WIFI_STATUS:DISCONNECTED:0.0.0.0:0:");
      Serial.println("[WIFI] Connection timed out / failed.");
    }
  }

  // 2.1 LAN WebSocket
  handleWsClient();

  bool isAnyClientConnected = deviceConnected || wsClientConnected;

  // 3. BLE re-advertising on disconnect
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
    if (bootOtaError.length()) {
      notifyBle("OTA_ERROR:" + bootOtaError);   // reason the last update failed
      bootOtaError = "";
    }
    Serial.println("[BLE] Client connected and synchronized!");
  }

  // 4. Mode execution
  if (currentMode == MODE_AUTO_AVOID) {
    runAutonomousObstacleAvoidance();
  } else {
    if (isAnyClientConnected) {
      if (lastCommandChar != 'S' && (currentMillis - lastCommandTimestamp > FAILSAFE_TIMEOUT_MS)) {
        stopMotors();
        lastCommandChar = 'S';
      }
    } else {
      stopMotors();
    }
  }

  // 5. Telemetry (every 100 ms when connected)
  if (isAnyClientConnected && (currentMillis - lastTelemetryMillis >= 100)) {
    lastTelemetryMillis = currentMillis;
    unsigned long uptimeSec = currentMillis / 1000;

    if (currentMode == MODE_MANUAL && lastCommandChar == 'S') {
      long d = enableUltrasonic ? getDistanceCM() : -1;
      if (d > 0) lastMeasuredCenterDist = d;
      lastLeftIrBlocked = enableIrLeft ? (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE) : false;
      lastRightIrBlocked = enableIrRight ? (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE) : false;
    }

    // T:<uptime>,<center_dist_cm>,<ir_left>,<ir_right>,<servo_angle>,<battery_pct>,<battery_v>,<mode>
    char modeChar = (currentMode == MODE_AUTO_AVOID) ? 'A' : 'M';
    float batV = 7.8f;
    int batPct = getBatteryLevel(batV);

    char telemetry[80];
    snprintf(telemetry, sizeof(telemetry), "T:%lu,%ld,%d,%d,%d,%d,%.2f,%c",
             uptimeSec,
             lastMeasuredCenterDist,
             lastLeftIrBlocked ? 1 : 0,
             lastRightIrBlocked ? 1 : 0,
             currentServoAngle,
             batPct,
             batV,
             modeChar);

    notifyBle(telemetry);
  }

  delay(2);
}
