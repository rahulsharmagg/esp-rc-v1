/**
 * ============================================================================
 * Project: ESP32 BLE RC & Autonomous Obstacle-Avoiding Robot
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

// ============================================================================
// HARDWARE PIN DEFINITIONS (Matched to your wiring)
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
  // 1. Read IR Sensors
  bool leftBlocked  = (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE);
  bool rightBlocked = (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE);
  lastLeftIrBlocked = leftBlocked;
  lastRightIrBlocked = rightBlocked;

  // 2. Read Ultrasonic Distance
  long distanceCenter = getDistanceCM();
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
  if (distanceCenter > 0 && distanceCenter < SAFE_DISTANCE_CM) {
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
// MOTION & BLUETOOTH COMMAND HANDLER
// ============================================================================

void processCommand(const String& cmd) {
  if (cmd.length() == 0) return;

  lastCommandTimestamp = millis();
  char c = cmd.charAt(0);

  // 1. Mode Selection Commands
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

  // 2. Throttle / Speed Command (e.g. "V200")
  if (c == 'V') {
    int val = cmd.substring(1).toInt();
    currentSpeed = constrain(val, 50, 255);
    Serial.printf("[CONFIG] Speed set to: %d\n", currentSpeed);
    return;
  }

  // 3. Differential Tank Drive (e.g. "D:180,-180")
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

  // 4. Directional Motion Commands (Manual Touch Inputs)
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

  // 5. SG90 Servo Configuration
  scanServo.setPeriodHertz(50);
  scanServo.attach(SERVO_PIN, 500, 2400);
  scanServo.write(SERVO_CENTER);
  delay(400);

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

  Serial.println("[READY] BLE Advertising active. Ready for PWA pairing.");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  unsigned long currentMillis = millis();

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
      long d = getDistanceCM();
      if (d > 0) lastMeasuredCenterDist = d;
      lastLeftIrBlocked = (digitalRead(IR_LEFT) == IR_OBSTACLE_STATE);
      lastRightIrBlocked = (digitalRead(IR_RIGHT) == IR_OBSTACLE_STATE);
    }

    // Packet format: T:<uptime>,<center_dist_cm>,<mode>,<ir_left>,<ir_right>,<servo_angle>
    char modeChar = (currentMode == MODE_AUTO_AVOID) ? 'A' : 'M';
    String telemetry = "T:" + String(uptimeSec) + "," +
                       String(lastMeasuredCenterDist) + "," +
                       String(modeChar) + "," +
                       String(lastLeftIrBlocked ? 1 : 0) + "," +
                       String(lastRightIrBlocked ? 1 : 0) + "," +
                       String(currentServoAngle);

    pTxCharacteristic->setValue(telemetry.c_str());
    pTxCharacteristic->notify();
  }

  delay(5);
}
