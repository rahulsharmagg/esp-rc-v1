/**
 * ============================================================================
 * Project: ESP32 BLE RC Car Firmware (Nordic UART Service) + AUTONOMOUS DRIVE
 * Author: Antigravity Embedded Systems
 * Hardware: ESP32 Dev Module + Motor Driver + Ultrasonic Sensor (HC-SR04)
 * Communication: Web Bluetooth Low Energy (BLE GATT Server)
 * ============================================================================
 * 
 * BLE UUID Configuration:
 *   Service UUID:            6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   Rx Characteristic (W):   6E400002-B5A3-F393-E0A9-E50E24DCCA9E
 *   Tx Characteristic (N):   6E400003-B5A3-F393-E0A9-E50E24DCCA9E
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_arduino_version.h>

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================
// Motor A (Left Side)
#define MOTOR_LEFT_PWM      18   // PWM / Speed or IN1
#define MOTOR_LEFT_DIR      19   // Direction or IN2

// Motor B (Right Side)
#define MOTOR_RIGHT_PWM     22   // PWM / Speed or IN3
#define MOTOR_RIGHT_DIR     23   // Direction or IN4

// Ultrasonic Sensor (HC-SR04) for Autonomous Driving & Obstacle Avoidance
#define PIN_TRIG            5    // Ultrasonic Trigger Pin
#define PIN_ECHO            17   // Ultrasonic Echo Pin

// Optional Accessories
#define PIN_HEADLIGHTS      13   // LED Headlights
#define PIN_HORN            12   // Passive / Active Buzzer
#define PIN_STATUS_LED      2    // Built-in ESP32 LED (State Indicator)

// PWM Channel Configurations (ESP32 LEDC)
#define PWM_FREQ            20000 // 20 kHz (Silent, avoids audible motor whine)
#define PWM_RESOLUTION      8     // 8-bit resolution (0 - 255)
#define CH_LEFT_PWM         0
#define CH_LEFT_DIR         1
#define CH_RIGHT_PWM        2
#define CH_RIGHT_DIR        3

// ============================================================================
// CONSTANTS & FAILSAFE CONFIGURATION
// ============================================================================
#define DEVICE_NAME             "ESP32-RC-CAR"
#define SERVICE_UUID            "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Safety: Halt motors if no BLE command received within FAILSAFE_TIMEOUT_MS in manual mode
#define FAILSAFE_TIMEOUT_MS     600 

// Autonomous Thresholds (in cm)
#define OBSTACLE_STOP_CM        22   // Trigger obstacle avoidance routine
#define OBSTACLE_SLOW_CM        40   // Slow down approaching obstacle

// ============================================================================
// OPERATING MODES & STATE MACHINE
// ============================================================================
enum DriveMode {
  MODE_MANUAL = 0,
  MODE_AUTO_AVOID = 1,
  MODE_AUTO_PATROL = 2
};

enum AutoSubState {
  AUTO_FORWARD,
  AUTO_BRAKE,
  AUTO_REVERSE,
  AUTO_TURN_LEFT,
  AUTO_TURN_RIGHT
};

// ============================================================================
// GLOBAL STATE VARIABLES
// ============================================================================
BLEServer* pServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

volatile unsigned long lastCommandTimestamp = 0;
volatile uint8_t currentSpeed = 200;      // 0 to 255
char lastCommandChar = 'S';
unsigned long lastTelemetryMillis = 0;

// Autonomous State
DriveMode currentMode = MODE_MANUAL;
AutoSubState autoState = AUTO_FORWARD;
unsigned long autoStateTimer = 0;
int currentDistanceCm = 100;
unsigned long lastDistanceScanMillis = 0;
bool turnDirectionToggle = false; // Alternates left/right turns to avoid corner traps

// ============================================================================
// MOTOR CONTROL PRIMITIVES (Core 2.x & 3.x Dual-Compatible)
// ============================================================================
void initHardware() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  // ESP32 Arduino Core v3.x API
  ledcAttachChannel(MOTOR_LEFT_PWM, PWM_FREQ, PWM_RESOLUTION, CH_LEFT_PWM);
  ledcAttachChannel(MOTOR_LEFT_DIR, PWM_FREQ, PWM_RESOLUTION, CH_LEFT_DIR);
  ledcAttachChannel(MOTOR_RIGHT_PWM, PWM_FREQ, PWM_RESOLUTION, CH_RIGHT_PWM);
  ledcAttachChannel(MOTOR_RIGHT_DIR, PWM_FREQ, PWM_RESOLUTION, CH_RIGHT_DIR);
#else
  // ESP32 Arduino Core v2.x API
  ledcSetup(CH_LEFT_PWM, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(MOTOR_LEFT_PWM, CH_LEFT_PWM);
  ledcSetup(CH_LEFT_DIR, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(MOTOR_LEFT_DIR, CH_LEFT_DIR);

  ledcSetup(CH_RIGHT_PWM, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(MOTOR_RIGHT_PWM, CH_RIGHT_PWM);
  ledcSetup(CH_RIGHT_DIR, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(MOTOR_RIGHT_DIR, CH_RIGHT_DIR);
#endif

  pinMode(PIN_HEADLIGHTS, OUTPUT);
  pinMode(PIN_HORN, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  
  // Ultrasonic Sensor
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  digitalWrite(PIN_TRIG, LOW);
  digitalWrite(PIN_HEADLIGHTS, LOW);
  digitalWrite(PIN_HORN, LOW);
  digitalWrite(PIN_STATUS_LED, LOW);
}

// Drive left motor: speed (-255 to +255)
void setLeftMotor(int speed) {
  speed = constrain(speed, -255, 255);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  if (speed > 0) {
    ledcWrite(MOTOR_LEFT_PWM, speed);
    ledcWrite(MOTOR_LEFT_DIR, 0);
  } else if (speed < 0) {
    ledcWrite(MOTOR_LEFT_PWM, 0);
    ledcWrite(MOTOR_LEFT_DIR, -speed);
  } else {
    ledcWrite(MOTOR_LEFT_PWM, 0);
    ledcWrite(MOTOR_LEFT_DIR, 0);
  }
#else
  if (speed > 0) {
    ledcWrite(CH_LEFT_PWM, speed);
    ledcWrite(CH_LEFT_DIR, 0);
  } else if (speed < 0) {
    ledcWrite(CH_LEFT_PWM, 0);
    ledcWrite(CH_LEFT_DIR, -speed);
  } else {
    ledcWrite(CH_LEFT_PWM, 0);
    ledcWrite(CH_LEFT_DIR, 0);
  }
#endif
}

// Drive right motor: speed (-255 to +255)
void setRightMotor(int speed) {
  speed = constrain(speed, -255, 255);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  if (speed > 0) {
    ledcWrite(MOTOR_RIGHT_PWM, speed);
    ledcWrite(MOTOR_RIGHT_DIR, 0);
  } else if (speed < 0) {
    ledcWrite(MOTOR_RIGHT_PWM, 0);
    ledcWrite(MOTOR_RIGHT_DIR, -speed);
  } else {
    ledcWrite(MOTOR_RIGHT_PWM, 0);
    ledcWrite(MOTOR_RIGHT_DIR, 0);
  }
#else
  if (speed > 0) {
    ledcWrite(CH_RIGHT_PWM, speed);
    ledcWrite(CH_RIGHT_DIR, 0);
  } else if (speed < 0) {
    ledcWrite(CH_RIGHT_PWM, 0);
    ledcWrite(CH_RIGHT_DIR, -speed);
  } else {
    ledcWrite(CH_RIGHT_PWM, 0);
    ledcWrite(CH_RIGHT_DIR, 0);
  }
#endif
}

void stopMotors() {
  setLeftMotor(0);
  setRightMotor(0);
}

// ============================================================================
// ULTRASONIC SENSOR READING
// ============================================================================
int readUltrasonicDistance() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Timeout after 18ms (~300cm max range) to avoid blocking loop
  long duration = pulseIn(PIN_ECHO, HIGH, 18000);
  if (duration == 0) {
    return 300; // No obstacle within range
  }
  int cm = (int)(duration * 0.0343 / 2);
  if (cm <= 0 || cm > 300) return 300;
  return cm;
}

// ============================================================================
// AUTONOMOUS DRIVING DECISION ENGINE
// ============================================================================
void handleAutonomousAvoidance() {
  unsigned long now = millis();
  int speed = currentSpeed;
  int cruiseSpeed = min(speed, 180); // Moderate speed for autonomous safety

  switch (autoState) {
    case AUTO_FORWARD:
      if (currentDistanceCm <= OBSTACLE_STOP_CM) {
        // Obstacle detected! Immediate brake
        stopMotors();
        autoState = AUTO_BRAKE;
        autoStateTimer = now;
      } else if (currentDistanceCm <= OBSTACLE_SLOW_CM) {
        // Approaching obstacle: Slow down
        int slowSpeed = map(currentDistanceCm, OBSTACLE_STOP_CM, OBSTACLE_SLOW_CM, 110, cruiseSpeed);
        setLeftMotor(slowSpeed);
        setRightMotor(slowSpeed);
      } else {
        // Clear path: Normal forward cruise
        setLeftMotor(cruiseSpeed);
        setRightMotor(cruiseSpeed);
      }
      break;

    case AUTO_BRAKE:
      stopMotors();
      if (now - autoStateTimer > 150) {
        // Reverse slightly to create maneuvering clearance
        autoState = AUTO_REVERSE;
        autoStateTimer = now;
      }
      break;

    case AUTO_REVERSE:
      setLeftMotor(-cruiseSpeed);
      setRightMotor(-cruiseSpeed);
      if (now - autoStateTimer > 350) {
        stopMotors();
        // Alternate turns or turn towards clearer side
        turnDirectionToggle = !turnDirectionToggle;
        autoState = turnDirectionToggle ? AUTO_TURN_LEFT : AUTO_TURN_RIGHT;
        autoStateTimer = now;
      }
      break;

    case AUTO_TURN_LEFT:
      setLeftMotor(-cruiseSpeed);
      setRightMotor(cruiseSpeed);
      if (now - autoStateTimer > 400) {
        stopMotors();
        autoState = AUTO_FORWARD;
      }
      break;

    case AUTO_TURN_RIGHT:
      setLeftMotor(cruiseSpeed);
      setRightMotor(-cruiseSpeed);
      if (now - autoStateTimer > 400) {
        stopMotors();
        autoState = AUTO_FORWARD;
      }
      break;
  }
}

void handleAutonomousPatrol() {
  unsigned long now = millis();
  int speed = min((int)currentSpeed, 170);

  // Safety collision check even during patrol
  if (currentDistanceCm <= OBSTACLE_STOP_CM) {
    stopMotors();
    autoState = AUTO_BRAKE;
    currentMode = MODE_AUTO_AVOID;
    return;
  }

  // 8-second repeating patrol pattern (Forward 2s -> Turn Left 0.6s -> Forward 2s -> Turn Right 0.6s)
  unsigned long patternTime = (now - autoStateTimer) % 6000;
  if (patternTime < 2200) {
    setLeftMotor(speed);
    setRightMotor(speed); // Forward
  } else if (patternTime < 3000) {
    setLeftMotor(-speed);
    setRightMotor(speed); // Turn Left
  } else if (patternTime < 5200) {
    setLeftMotor(speed);
    setRightMotor(speed); // Forward
  } else {
    setLeftMotor(speed);
    setRightMotor(-speed); // Turn Right
  }
}

// ============================================================================
// MOTION COMMAND HANDLER
// ============================================================================
void processCommand(const String& cmd) {
  if (cmd.length() == 0) return;

  lastCommandTimestamp = millis();
  char c = cmd.charAt(0);

  // Autonomous Mode Controls
  if (c == 'A') { // Engage Auto Obstacle Avoidance
    currentMode = MODE_AUTO_AVOID;
    autoState = AUTO_FORWARD;
    autoStateTimer = millis();
    Serial.println("[MODE] Autonomous Obstacle Avoidance Engaged.");
    return;
  }
  if (c == 'a') { // Disengage Auto Mode -> Return to Manual
    currentMode = MODE_MANUAL;
    stopMotors();
    Serial.println("[MODE] Returned to Manual Control.");
    return;
  }
  if (c == 'P') { // Engage Auto Patrol Mode
    currentMode = MODE_AUTO_PATROL;
    autoStateTimer = millis();
    Serial.println("[MODE] Autonomous Patrol Mode Engaged.");
    return;
  }

  // 1. Speed Adjustment Command (e.g., "V220")
  if (c == 'V') {
    int val = cmd.substring(1).toInt();
    currentSpeed = (uint8_t)constrain(val, 0, 255);
    return;
  }

  // 2. Differential Drive Command (e.g., "D:180,-180")
  if (c == 'D' && cmd.charAt(1) == ':') {
    currentMode = MODE_MANUAL; // Manual input cancels autonomous mode
    int commaIdx = cmd.indexOf(',');
    if (commaIdx > 2) {
      int leftPwr = cmd.substring(2, commaIdx).toInt();
      int rightPwr = cmd.substring(commaIdx + 1).toInt();
      setLeftMotor(leftPwr);
      setRightMotor(rightPwr);
      return;
    }
  }

  // 3. Accessory Commands
  if (c == 'W') { digitalWrite(PIN_HEADLIGHTS, HIGH); return; }
  if (c == 'w') { digitalWrite(PIN_HEADLIGHTS, LOW);  return; }
  if (c == 'U') { digitalWrite(PIN_HORN, HIGH);        return; }
  if (c == 'u') { digitalWrite(PIN_HORN, LOW);         return; }

  // 4. Directional Matrix (Manual Mode)
  // Any directional input immediately disengages autonomous modes
  currentMode = MODE_MANUAL;
  lastCommandChar = c;
  int spd = currentSpeed;
  int halfSpd = currentSpeed / 2;

  switch (c) {
    case 'F': // Forward
      setLeftMotor(spd);
      setRightMotor(spd);
      break;

    case 'B': // Reverse
      setLeftMotor(-spd);
      setRightMotor(-spd);
      break;

    case 'L': // Spin Left (Zero turn)
      setLeftMotor(-spd);
      setRightMotor(spd);
      break;

    case 'R': // Spin Right (Zero turn)
      setLeftMotor(spd);
      setRightMotor(-spd);
      break;

    case 'G': // Forward-Left (Arc Turn)
      setLeftMotor(halfSpd);
      setRightMotor(spd);
      break;

    case 'I': // Forward-Right (Arc Turn)
      setLeftMotor(spd);
      setRightMotor(halfSpd);
      break;

    case 'H': // Reverse-Left
      setLeftMotor(-halfSpd);
      setRightMotor(-spd);
      break;

    case 'J': // Reverse-Right
      setLeftMotor(-spd);
      setRightMotor(-halfSpd);
      break;

    case 'S': // Hard Stop / Brake
    default:
      stopMotors();
      break;
  }
}

// ============================================================================
// BLE CALLBACKS & PROTOCOL
// ============================================================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    digitalWrite(PIN_STATUS_LED, HIGH);
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    currentMode = MODE_MANUAL;
    digitalWrite(PIN_STATUS_LED, LOW);
    stopMotors(); // Immediate stop on disconnect
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();

    if (rxValue.length() > 0) {
      processCommand(rxValue);

      // Send telemetry echo back to client for RTT / latency measuring
      if (deviceConnected && pTxCharacteristic) {
        String ack = "ACK:" + rxValue;
        pTxCharacteristic->setValue(ack.c_str());
        pTxCharacteristic->notify();
      }
    }
  }
};

// ============================================================================
// MAIN SETUP & LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n[ESP32-RC] Initializing System...");

  // Initialize motor channels, pins, and ultrasonic sensor
  initHardware();
  stopMotors();

  // Initialize BLE Stack
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  // Create Nordic UART Service
  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Create Tx Characteristic (Notify to Client)
  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // Create Rx Characteristic (Write from Client)
  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  // Start Service & Advertising
  pService->start();
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[ESP32-RC] BLE Advertising started. Ready for PWA connection.");
}

void loop() {
  unsigned long currentMillis = millis();

  // 1. Connection Lifecycle & Auto Re-advertising
  if (!deviceConnected && oldDeviceConnected) {
    delay(200);
    pServer->startAdvertising();
    Serial.println("[ESP32-RC] Restarted advertising after disconnect.");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    lastCommandTimestamp = currentMillis;
    currentMode = MODE_MANUAL;
    Serial.println("[ESP32-RC] Client successfully linked!");
  }

  // 2. Periodic Ultrasonic Scan (every 60ms)
  if (currentMillis - lastDistanceScanMillis >= 60) {
    lastDistanceScanMillis = currentMillis;
    currentDistanceCm = readUltrasonicDistance();
  }

  // 3. Autonomous Drive Execution or Manual Failsafe
  if (currentMode == MODE_AUTO_AVOID) {
    handleAutonomousAvoidance();
  } else if (currentMode == MODE_AUTO_PATROL) {
    handleAutonomousPatrol();
  } else {
    // Manual Mode Failsafe: Prevent runaway car if connection drops
    if (deviceConnected) {
      if (lastCommandChar != 'S' && (currentMillis - lastCommandTimestamp > FAILSAFE_TIMEOUT_MS)) {
        stopMotors();
        lastCommandChar = 'S';
      }
    } else {
      stopMotors();
    }
  }

  // 4. Telemetry Heartbeat Broadcast (every 250ms when connected)
  if (deviceConnected && (currentMillis - lastTelemetryMillis >= 250)) {
    lastTelemetryMillis = currentMillis;
    unsigned long uptimeSec = currentMillis / 1000;
    
    // Telemetry packet: "T:<uptime>,<dist_cm>,<mode>"
    char modeChar = (currentMode == MODE_AUTO_AVOID) ? 'A' : (currentMode == MODE_AUTO_PATROL ? 'P' : 'M');
    String telemetry = "T:" + String(uptimeSec) + "," + String(currentDistanceCm) + "," + String(modeChar);
    pTxCharacteristic->setValue(telemetry.c_str());
    pTxCharacteristic->notify();
  }

  delay(5); // Yield for FreeRTOS scheduler
}
