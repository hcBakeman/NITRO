export const VEHICLE_CLASSES = {
    'dacia_duster_low_poly': { mass: 1400.0, maxEngineTorque: 350.0, frictionMult: 1.0 },
    'police_car': { mass: 1800.0, maxEngineTorque: 430.0, frictionMult: 1.0 },
    'retro_anime_suzuki_alto': { mass: 700.0, maxEngineTorque: 240.0, frictionMult: 0.9 },
    'volkswagen_golf_gti_1976': { mass: 900.0, maxEngineTorque: 280.0, frictionMult: 0.95 },
    'volvo_240': { mass: 1300.0, maxEngineTorque: 340.0, frictionMult: 1.0 }
};

export const BASE_VEHICLE_CONFIG = {
    wheelRadius: 0.3,
    wheelWidth: 0.1,
    halfVehicleLength: 2.0,
    halfVehicleWidth: 0.9,
    halfVehicleHeight: 0.2,
    wheelOffsetHorizontal: 1.4,
    wheelOffsetVertical: -0.1,
    suspensionMinLength: 0.1,
    suspensionMaxLength: 0.25,
    maxSteerAngle: (Math.PI / 180) * 40,
    fourWheelDrive: true,
    frontBackLimitedSlipRatio: 1.4,
    leftRightLimitedSlipRatio: 1.4,
    antiRollbar: true,
    clutchStrength: 20.0,
    antiRollStiffness: 3000.0,
    centerOfMassYOffset: -0.2
};

export function createJoltVehicle(Jolt, physicsSystem, bodyInterface, position, rotation, layer, handlingMode = 'arcade', carModel = 'dacia_duster_low_poly') {
    let currentSpeedKmh = 0.0;
    const { 
        wheelRadius, wheelWidth, halfVehicleLength, halfVehicleWidth, halfVehicleHeight, 
        wheelOffsetHorizontal, wheelOffsetVertical, suspensionMinLength, suspensionMaxLength, 
        maxSteerAngle, fourWheelDrive, frontBackLimitedSlipRatio, leftRightLimitedSlipRatio, 
        antiRollbar, clutchStrength, antiRollStiffness, centerOfMassYOffset
    } = BASE_VEHICLE_CONFIG;

    const classStats = VEHICLE_CLASSES[carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
    const vehicleMass = classStats.mass;
    const maxEngineTorque = classStats.maxEngineTorque;
    const tireFrictionMult = classStats.frictionMult || 1.0;

    const FL_WHEEL = 0;
    const FR_WHEEL = 1;
    const BL_WHEEL = 2;
    const BR_WHEEL = 3;



    // Handle position array or Jolt.RVec3
    let posVec;
    if (Array.isArray(position)) {
        posVec = new Jolt.RVec3(position[0], position[1], position[2]);
    } else {
        posVec = position; // Assume it's already a Jolt.RVec3
    }

    // Create car body
    const offsetVec = new Jolt.Vec3(0, centerOfMassYOffset, 0);
    const boxVec = new Jolt.Vec3(halfVehicleWidth, halfVehicleHeight, halfVehicleLength);
    const boxShapeSettings = new Jolt.BoxShapeSettings(boxVec);
    const carShapeSettings = new Jolt.OffsetCenterOfMassShapeSettings(offsetVec, boxShapeSettings);
    
    const shapeResult = carShapeSettings.Create();
    const carShape = shapeResult.Get();
    
    let rotQuat;
    let rotAxis = null;
    if (Array.isArray(rotation)) {
        rotQuat = new Jolt.Quat(rotation[0], rotation[1], rotation[2], rotation[3]);
    } else if (rotation) {
        rotQuat = rotation; // Assume it's already a Jolt.Quat
    } else {
        rotAxis = new Jolt.Vec3(0, 1, 0);
        rotQuat = Jolt.Quat.prototype.sRotation(rotAxis, Math.PI);
    }
    
    const carBodySettings = new Jolt.BodyCreationSettings(
        carShape, 
        posVec,
        rotQuat,
        Jolt.EMotionType_Dynamic, 
        layer
    );
    
    carBodySettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    carBodySettings.mUserData = 2;
    carBodySettings.mMassPropertiesOverride.mMass = vehicleMass;
    carBodySettings.mMotionQuality = Jolt.EMotionQuality_LinearCast; // Enable CCD to prevent tunneling through the track when falling
    const chassisBody = bodyInterface.CreateBody(carBodySettings);

    // IMPORTANT: Add body to physics system BEFORE adding constraint!
    bodyInterface.AddBody(chassisBody.GetID(), Jolt.EActivation_Activate);

    // Create vehicle constraint
    const vehicleSettings = new Jolt.VehicleConstraintSettings();
    // Increase to near 180 to prevent the constraint from hitting an invisible wall and bouncing the car up
    vehicleSettings.mMaxPitchRollAngle = (Math.PI / 180) * 179.0;
    vehicleSettings.mWheels.clear();

    const fl = new Jolt.WheelSettingsWV();
    fl.mPosition = new Jolt.Vec3(-halfVehicleWidth, -wheelOffsetVertical, wheelOffsetHorizontal);
    fl.mMaxSteerAngle = maxSteerAngle;
    fl.mMaxHandBrakeTorque = 0.0;
    vehicleSettings.mWheels.push_back(fl);

    const fr = new Jolt.WheelSettingsWV();
    fr.mPosition = new Jolt.Vec3(halfVehicleWidth, -wheelOffsetVertical, wheelOffsetHorizontal);
    fr.mMaxSteerAngle = maxSteerAngle;
    fr.mMaxHandBrakeTorque = 0.0; // Front wheel doesn't have hand brake
    vehicleSettings.mWheels.push_back(fr);

    const bl = new Jolt.WheelSettingsWV();
    bl.mPosition = new Jolt.Vec3(-halfVehicleWidth, -wheelOffsetVertical, -wheelOffsetHorizontal);
    bl.mMaxSteerAngle = 0.0;
    vehicleSettings.mWheels.push_back(bl);

    const br = new Jolt.WheelSettingsWV();
    br.mPosition = new Jolt.Vec3(halfVehicleWidth, -wheelOffsetVertical, -wheelOffsetHorizontal);
    br.mMaxSteerAngle = 0.0;
    vehicleSettings.mWheels.push_back(br);

    const wheels = [fl, fr, bl, br];
    wheels.forEach(wheelS => {
        wheelS.mRadius = wheelRadius;
        wheelS.mWidth = wheelWidth;
        wheelS.mSuspensionMinLength = suspensionMinLength;
        wheelS.mSuspensionMaxLength = suspensionMaxLength;
        wheelS.mSuspensionSpring.mFrequency = 2.0;
        wheelS.mSuspensionSpring.mDamping = 0.7;
    });

    const controllerSettings = new Jolt.WheeledVehicleControllerSettings();
    controllerSettings.mEngine.mMaxTorque = maxEngineTorque;
    controllerSettings.mEngine.mInertia = 0.2; // Less flywheel energy to prevent ghost launches
    controllerSettings.mEngine.mMinRPM = 1000.0;
    controllerSettings.mEngine.mMaxRPM = 10000.0; // Prevent torque dropping to 0 during wheel slip
    // MUST be > maxEngineTorque or engine will endlessly over-rev, introduce NaN into solver, and infinite loop!
    controllerSettings.mTransmission.mClutchStrength = Math.max(400.0, maxEngineTorque * 2.0); 
    controllerSettings.mTransmission.mSwitchTime = 0.2;
    controllerSettings.mTransmission.mShiftUpRPM = 8000.0;
    controllerSettings.mTransmission.mShiftDownRPM = 3000.0;
    vehicleSettings.mController = controllerSettings;

    // Front differential
    controllerSettings.mDifferentials.clear();
    const frontWheelDrive = new Jolt.VehicleDifferentialSettings();
    frontWheelDrive.mLeftWheel = FL_WHEEL;
    frontWheelDrive.mRightWheel = FR_WHEEL;
    frontWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
    if (fourWheelDrive) {
        frontWheelDrive.mEngineTorqueRatio = 0.35; // 35% torque to front to prevent understeer during acceleration
    }
    controllerSettings.mDifferentials.push_back(frontWheelDrive);
    controllerSettings.mDifferentialLimitedSlipRatio = frontBackLimitedSlipRatio;

    // Rear differential
    if (fourWheelDrive) {
        const rearWheelDrive = new Jolt.VehicleDifferentialSettings();
        rearWheelDrive.mLeftWheel = BL_WHEEL;
        rearWheelDrive.mRightWheel = BR_WHEEL;
        rearWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
        rearWheelDrive.mEngineTorqueRatio = 0.65; // 65% torque to rear for sporty acceleration
        controllerSettings.mDifferentials.push_back(rearWheelDrive);
    }

    // Anti-roll bars
    if (antiRollbar) {
        vehicleSettings.mAntiRollBars.clear();
        
        const frontRollBar = new Jolt.VehicleAntiRollBar();
        frontRollBar.mLeftWheel = FL_WHEEL;
        frontRollBar.mRightWheel = FR_WHEEL;
        frontRollBar.mStiffness = antiRollStiffness;
        
        const rearRollBar = new Jolt.VehicleAntiRollBar();
        rearRollBar.mLeftWheel = BL_WHEEL;
        rearRollBar.mRightWheel = BR_WHEEL;
        rearRollBar.mStiffness = antiRollStiffness;
        
        vehicleSettings.mAntiRollBars.push_back(frontRollBar);
        vehicleSettings.mAntiRollBars.push_back(rearRollBar);
    }

    const constraint = new Jolt.VehicleConstraint(chassisBody, vehicleSettings);

    // Set collision tester that checks the wheels for collision with the floor
    const tester = new Jolt.VehicleCollisionTesterCastCylinder(layer, 0.05);
    constraint.SetVehicleCollisionTester(tester);

    // Vehicle constraint callbacks
    const callbacks = new Jolt.VehicleConstraintCallbacksJS();
    callbacks.GetCombinedFriction = (wheelIndex, tireFrictionDirection, tireFriction, body2, subShapeID2) => {
        body2 = Jolt.wrapPointer(body2, Jolt.Body);
        return Math.sqrt(tireFriction * body2.GetFriction());
    };
    callbacks.OnPreStepCallback = (vehicle, stepContext) => {
        const mode = handlingMode;
        const isRally = (mode === 'rally' || mode === 'rally (drift)');
        const isSegaRally = (mode === 'segarally');

        const linVel = chassisBody.GetLinearVelocity();
        const vx = linVel.GetX(), vy = linVel.GetY(), vz = linVel.GetZ();
        currentSpeedKmh = Math.sqrt(vx*vx + vy*vy + vz*vz) * 3.6;

        if (!isRally && !isSegaRally) return;

        const chassisId = chassisBody.GetID();
        const quat = chassisBody.GetRotation();
        
        const localForward = new Jolt.Vec3(0, 0, 1);
        const forward = quat.MulVec3(localForward);
        
        const localUp = new Jolt.Vec3(0, 1, 0);
        const up = quat.MulVec3(localUp);
        
        const forwardSpeed = (linVel.GetX() * forward.GetX()) + (linVel.GetY() * forward.GetY()) + (linVel.GetZ() * forward.GetZ());

        // ── Downforce ──
        // Sega Rally: stronger downforce to keep car pinned at speed
        const downforceCoef = isSegaRally ? 8.0 : 5.0; 
        const downforceMagnitude = Math.abs(forwardSpeed) * downforceCoef;
        
        if (downforceMagnitude > 0) {
            const downforce = new Jolt.Vec3(-up.GetX() * downforceMagnitude, -up.GetY() * downforceMagnitude, -up.GetZ() * downforceMagnitude);
            chassisBody.AddForce(downforce);
            Jolt.destroy(downforce);
        }

        // ── Sega Rally: Brake Weight Transfer (pitch torque) ──
        // When braking at speed, apply a forward pitch torque around the car's lateral axis.
        // This shifts weight to the front axle, making the rear light and loose.
        // Combined with steering, this creates the signature brake-flick drift entry.
        if (isSegaRally) {
            const brakeAmount = controller._currentBrake || 0;
            if (brakeAmount > 0.1 && Math.abs(forwardSpeed) > 5.0) {
                // Lateral axis = cross(forward, up) = right vector
                const localRight = new Jolt.Vec3(1, 0, 0);
                const right = quat.MulVec3(localRight);
                
                const pitchMagnitude = brakeAmount * Math.abs(forwardSpeed) * 0.3;
                const pitchTorque = new Jolt.Vec3(
                    right.GetX() * pitchMagnitude,
                    right.GetY() * pitchMagnitude,
                    right.GetZ() * pitchMagnitude
                );
                chassisBody.AddTorque(pitchTorque);
                
                Jolt.destroy(localRight);
                Jolt.destroy(right);
                Jolt.destroy(pitchTorque);
            }
        }
        
        Jolt.destroy(localForward);
        Jolt.destroy(forward);
        Jolt.destroy(localUp);
        Jolt.destroy(up);
    };
    callbacks.OnPostCollideCallback = (vehicle, stepContext) => { };
    callbacks.OnPostStepCallback = (vehicle, stepContext) => { };
    callbacks.SetVehicleConstraint(constraint);

    physicsSystem.AddConstraint(constraint);
    const controller = Jolt.castObject(constraint.GetController(), Jolt.WheeledVehicleController);

    // Set the vehicle controller callbacks
    const controllerCallbacks = new Jolt.WheeledVehicleControllerCallbacksJS();
    controllerCallbacks.OnTireMaxImpulseCallback = (wheelIndex, result, suspensionImpulse, longitudinalFriction, lateralFriction, longitudinalSlip, lateralSlip, deltaTime) => {
        result = Jolt.wrapPointer(result, Jolt.TireMaxImpulseCallbackResult);
        
        let longFrictionMult = tireFrictionMult * 1.5; // Base straight line grip
        let latFrictionMult = tireFrictionMult * 1.6;  // Base cornering grip
        
        const isRearWheel = (wheelIndex === 2 || wheelIndex === 3);
        const handbrake = controller._currentHandbrake || 0.0;

        if (handlingMode === 'rally' || handlingMode === 'rally (drift)') {
            if (isRearWheel && handbrake > 0.1) {
                // Handbrake initiated drift
                latFrictionMult = 0.4;
                longFrictionMult = 0.8; 
            } else {
                // Power slide / high slip velocity drop-off
                const slipVelocity = Math.abs(lateralSlip);
                if (slipVelocity > 4.0) { 
                    latFrictionMult = isRearWheel ? 0.9 : 1.2; // Rear slides more than front
                } else if (slipVelocity < 1.0 && handbrake < 0.1) {
                    // Planted grip
                    latFrictionMult = 1.9;
                }
            }
        } else if (handlingMode === 'segarally') {
            // ═══════════════════════════════════════════════════════════════
            // SEGA RALLY CHAMPIONSHIP (1995) — "Sliding on Rails" Friction
            // ═══════════════════════════════════════════════════════════════
            // Key design: longitudinal friction stays HIGH during drifts so
            // the car maintains forward speed while sliding sideways.
            // Front wheels always grip more laterally than rear = pivot point.
            // ═══════════════════════════════════════════════════════════════

            // ── Tuning Constants (tweak these!) ──
            const SEGA_LONG_DRIFT      = 1.4;  // Forward grip while drifting (keeps momentum)
            const SEGA_LONG_NORMAL     = 1.5;  // Forward grip normally
            const SEGA_LONG_FRONT      = 1.6;  // Front forward grip (slightly higher)
            const SEGA_LAT_HANDBRAKE_R = 0.35; // Rear lateral grip during handbrake (very loose)
            const SEGA_LAT_HANDBRAKE_F = 1.8;  // Front lateral grip during handbrake (pivot point)
            const SEGA_LAT_SLIDE_R     = 0.6;  // Rear lateral grip during power slide (slightly looser)
            const SEGA_LAT_SLIDE_F     = 1.8;  // Front lateral grip during power slide (grippy front)
            const SEGA_LAT_RECOVERY    = 1.5;  // Lateral grip in counter-steer recovery zone
            const SEGA_LAT_PLANTED     = 2.2;  // Lateral grip when fully planted (very high!)
            const SEGA_SLIDE_THRESHOLD = 2.0;  // Slip velocity to enter slide state
            const SEGA_RECOVERY_THRESH = 1.0;  // Slip velocity to enter recovery zone
            const SEGA_PLANTED_THRESH  = 0.4;  // Slip velocity for full planted grip

            const slipVelocity = Math.abs(lateralSlip);
            const steerInput = controller._currentSteer || 0.0;

            // Auto-drift initiation: if steering hard at speed, we lower rear grip and boost front grip
            const isSteeringHard = Math.abs(steerInput) > 0.3;
            const isMovingAtSpeed = currentSpeedKmh > 30.0;
            const autoDriftActive = isSteeringHard && isMovingAtSpeed;

            if (handbrake > 0.1 || autoDriftActive) {
                // ── SLIDING INITIATED BY HANDBRAKE OR HARD STEERING ──
                // Rear: very low lateral grip, high forward grip = slide freely but keep speed
                // Front: high lateral grip = acts as a pivot point
                if (isRearWheel) {
                    latFrictionMult = SEGA_LAT_HANDBRAKE_R;
                    longFrictionMult = SEGA_LONG_DRIFT;
                } else {
                    latFrictionMult = SEGA_LAT_HANDBRAKE_F + 0.4; // Boost front grip further to pivot the nose in (2.2)
                    longFrictionMult = SEGA_LONG_FRONT;
                }
            } else if (slipVelocity > SEGA_SLIDE_THRESHOLD) {
                // ── POWER SLIDE ──
                // Car is sliding: rear is loose, front grips to create controlled rotation
                // Forward friction stays HIGH — this is "sliding on rails"
                if (isRearWheel) {
                    latFrictionMult = SEGA_LAT_SLIDE_R;
                    longFrictionMult = SEGA_LONG_NORMAL;
                } else {
                    latFrictionMult = SEGA_LAT_SLIDE_F;
                    longFrictionMult = SEGA_LONG_NORMAL;
                }
            } else if (slipVelocity > SEGA_RECOVERY_THRESH) {
                // ── RECOVERY ZONE ──
                // Counter-steering is bringing slip down — grip snaps back quickly
                // This enables fast left↔right drift chaining
                latFrictionMult = SEGA_LAT_RECOVERY;
                longFrictionMult = SEGA_LONG_FRONT;
            } else if (slipVelocity < SEGA_PLANTED_THRESH) {
                // ── PLANTED GRIP ──
                // Driving straight or gentle cornering — car feels glued to the road
                latFrictionMult = SEGA_LAT_PLANTED;
                longFrictionMult = SEGA_LONG_NORMAL;
            } else {
                // Intermediate zone
                latFrictionMult = SEGA_LAT_RECOVERY;
                longFrictionMult = SEGA_LONG_NORMAL;
            }
        } else if (handlingMode === 'drift') {
            latFrictionMult = 0.9;
            if (isRearWheel) longFrictionMult = 0.8;
        } else {
            // Default Arcade/Simcade handling drift behavior
            const slipVelocity = Math.abs(lateralSlip);
            if (slipVelocity > 3.0) {
                latFrictionMult = isRearWheel ? (tireFrictionMult * 1.0) : (tireFrictionMult * 1.1); 
            }
        }

        result.mLongitudinalImpulse = (longitudinalFriction * longFrictionMult) * suspensionImpulse;
        result.mLateralImpulse = (lateralFriction * latFrictionMult) * suspensionImpulse;
    };
    controllerCallbacks.SetWheeledVehicleController(controller);

    // Step listener to update vehicle state during simulation steps
    const stepListener = new Jolt.VehicleConstraintStepListener(constraint);
    physicsSystem.AddStepListener(stepListener);

    // Cleanup Settings objects we own.
    // IMPORTANT ownership rules:
    //   - boxShapeSettings is consumed by carShapeSettings ctor → DO NOT destroy separately
    //   - vehicleSettings is consumed by VehicleConstraint ctor → DO NOT destroy separately
    //   - carShapeSettings / carBodySettings are safe to destroy after body creation
    //     because the body holds a ref-counted pointer to the actual shape.
    //   - offsetVec and boxVec are copied by value in C++ so we own them and must destroy.
    Jolt.destroy(carShapeSettings);
    Jolt.destroy(carBodySettings);
    Jolt.destroy(offsetVec);
    Jolt.destroy(boxVec);
    
    // Only destroy posVec/rotAxis/rotQuat if we allocated them.
    if (rotAxis) {
        Jolt.destroy(rotAxis);
    }
    if (Array.isArray(position)) {
        Jolt.destroy(posVec);
    }
    if (Array.isArray(rotation) || !rotation) {
        Jolt.destroy(rotQuat);
    }

    // Return the essential objects
    // Callers are responsible for maintaining references to callbacks/listeners if necessary, 
    // and correctly disposing of them when destroying the vehicle.
    return {
        constraint,
        chassisBody,
        controller,
        callbacks,
        controllerCallbacks,
        stepListener
    };
}
