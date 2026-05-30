export const VEHICLE_CLASSES = {
    'dacia_duster_low_poly': { mass: 1400.0, maxEngineTorque: 250.0, frictionMult: 1.0 },
    'police_car': { mass: 1800.0, maxEngineTorque: 330.0, frictionMult: 1.0 },
    'retro_anime_suzuki_alto': { mass: 700.0, maxEngineTorque: 140.0, frictionMult: 0.9 },
    'volkswagen_golf_gti_1976': { mass: 900.0, maxEngineTorque: 180.0, frictionMult: 0.95 },
    'volvo_240': { mass: 1300.0, maxEngineTorque: 240.0, frictionMult: 1.0 }
};

export const BASE_VEHICLE_CONFIG = {
    wheelRadius: 0.3,
    wheelWidth: 0.1,
    halfVehicleLength: 2.0,
    halfVehicleWidth: 0.9,
    halfVehicleHeight: 0.2,
    wheelOffsetHorizontal: 1.4,
    wheelOffsetVertical: 0.18,
    suspensionMinLength: 0.3,
    suspensionMaxLength: 0.5,
    maxSteerAngle: (Math.PI / 180) * 40,
    fourWheelDrive: true,
    frontBackLimitedSlipRatio: 0.4,
    leftRightLimitedSlipRatio: 1.4,
    antiRollbar: true,
    clutchStrength: 20.0,
    antiRollStiffness: 3000.0
};

export function createJoltVehicle(Jolt, physicsSystem, bodyInterface, position, rotation, layer, handlingMode = 'arcade', carModel = 'dacia_duster_low_poly') {
    const { 
        wheelRadius, wheelWidth, halfVehicleLength, halfVehicleWidth, halfVehicleHeight, 
        wheelOffsetHorizontal, wheelOffsetVertical, suspensionMinLength, suspensionMaxLength, 
        maxSteerAngle, fourWheelDrive, frontBackLimitedSlipRatio, leftRightLimitedSlipRatio, 
        antiRollbar, clutchStrength, antiRollStiffness
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
    const offsetVec = new Jolt.Vec3(0, -halfVehicleHeight, 0);
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
    carBodySettings.mMassPropertiesOverride.mMass = vehicleMass;
    const chassisBody = bodyInterface.CreateBody(carBodySettings);

    // IMPORTANT: Add body to physics system BEFORE adding constraint!
    bodyInterface.AddBody(chassisBody.GetID(), Jolt.EActivation_Activate);

    // Create vehicle constraint
    const vehicleSettings = new Jolt.VehicleConstraintSettings();
    vehicleSettings.mMaxPitchRollAngle = (Math.PI / 180) * 60.0;
    vehicleSettings.mWheels.clear();

    const fl = new Jolt.WheelSettingsWV();
    fl.mPosition = new Jolt.Vec3(halfVehicleWidth, -wheelOffsetVertical, wheelOffsetHorizontal);
    fl.mMaxSteerAngle = maxSteerAngle;
    fl.mMaxHandBrakeTorque = 0.0;
    vehicleSettings.mWheels.push_back(fl);

    const fr = new Jolt.WheelSettingsWV();
    fr.mPosition = new Jolt.Vec3(-halfVehicleWidth, -wheelOffsetVertical, wheelOffsetHorizontal);
    fr.mMaxSteerAngle = maxSteerAngle;
    fr.mMaxHandBrakeTorque = 0.0; // Front wheel doesn't have hand brake
    vehicleSettings.mWheels.push_back(fr);

    const bl = new Jolt.WheelSettingsWV();
    bl.mPosition = new Jolt.Vec3(halfVehicleWidth, -wheelOffsetVertical, -wheelOffsetHorizontal);
    bl.mMaxSteerAngle = 0.0;
    vehicleSettings.mWheels.push_back(bl);

    const br = new Jolt.WheelSettingsWV();
    br.mPosition = new Jolt.Vec3(-halfVehicleWidth, -wheelOffsetVertical, -wheelOffsetHorizontal);
    br.mMaxSteerAngle = 0.0;
    vehicleSettings.mWheels.push_back(br);

    const wheels = [fl, fr, bl, br];
    wheels.forEach(wheelS => {
        wheelS.mRadius = wheelRadius;
        wheelS.mWidth = wheelWidth;
        wheelS.mSuspensionMinLength = suspensionMinLength;
        wheelS.mSuspensionMaxLength = suspensionMaxLength;
    });

    const controllerSettings = new Jolt.WheeledVehicleControllerSettings();
    controllerSettings.mEngine.mMaxTorque = maxEngineTorque;
    controllerSettings.mEngine.mMaxRPM = 7000.0;
    // We increase clutch strength from 20.0 to 40.0 so the engine locks to wheels better
    controllerSettings.mTransmission.mClutchStrength = 40.0; 
    controllerSettings.mTransmission.mSwitchTime = 0.2;
    controllerSettings.mTransmission.mShiftUpRPM = 6500.0;
    // Lowered ShiftDownRPM to 1200 so it doesn't downshift to neutral while driving 25 km/h
    controllerSettings.mTransmission.mShiftDownRPM = 1200.0;
    vehicleSettings.mController = controllerSettings;

    // Front differential
    controllerSettings.mDifferentials.clear();
    const frontWheelDrive = new Jolt.VehicleDifferentialSettings();
    frontWheelDrive.mLeftWheel = FL_WHEEL;
    frontWheelDrive.mRightWheel = FR_WHEEL;
    frontWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
    if (fourWheelDrive) {
        frontWheelDrive.mEngineTorqueRatio = 0.5; // Split engine torque when 4WD
    }
    controllerSettings.mDifferentials.push_back(frontWheelDrive);
    controllerSettings.mDifferentialLimitedSlipRatio = frontBackLimitedSlipRatio;

    // Rear differential
    if (fourWheelDrive) {
        const rearWheelDrive = new Jolt.VehicleDifferentialSettings();
        rearWheelDrive.mLeftWheel = BL_WHEEL;
        rearWheelDrive.mRightWheel = BR_WHEEL;
        rearWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
        rearWheelDrive.mEngineTorqueRatio = 0.5;
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
        if (handlingMode !== 'rally' && handlingMode !== 'rally (drift)') return;

        const chassisId = chassisBody.GetID();
        const linVel = bodyInterface.GetLinearVelocity(chassisId);
        const quat = bodyInterface.GetRotation(chassisId);
        
        const localForward = new Jolt.Vec3(0, 0, 1);
        const forward = quat.MulVec3(localForward);
        
        const localUp = new Jolt.Vec3(0, 1, 0);
        const up = quat.MulVec3(localUp);
        
        const forwardSpeed = (linVel.GetX() * forward.GetX()) + (linVel.GetY() * forward.GetY()) + (linVel.GetZ() * forward.GetZ());
        const downforceCoef = 5.0; 
        const downforceMagnitude = Math.abs(forwardSpeed) * downforceCoef;
        
        if (downforceMagnitude > 0) {
            const downforce = new Jolt.Vec3(-up.GetX() * downforceMagnitude, -up.GetY() * downforceMagnitude, -up.GetZ() * downforceMagnitude);
            bodyInterface.AddForce(chassisId, downforce);
            Jolt.destroy(downforce);
        }
        
        Jolt.destroy(linVel);
        Jolt.destroy(quat);
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
        
        let longFrictionMult = tireFrictionMult;
        let latFrictionMult = tireFrictionMult * 1.15; // Simcade sporty grip
        
        const isRearWheel = (wheelIndex === 2 || wheelIndex === 3);
        const handbrake = controller._currentHandbrake || 0.0;

        if (handlingMode === 'rally' || handlingMode === 'rally (drift)') {
            latFrictionMult = 1.2;
            
            if (isRearWheel && handbrake > 0.1) {
                latFrictionMult = 0.3;
                longFrictionMult = 0.8; 
            } else {
                const slipAngle = Math.abs(lateralSlip);
                if (slipAngle > 0.15) {
                    latFrictionMult = isRearWheel ? 0.7 : 0.9; 
                }
            }
            
            if (Math.abs(lateralSlip) < 0.05 && handbrake < 0.1) {
                latFrictionMult = 1.5; 
            }
        } else if (handlingMode === 'drift') {
            latFrictionMult = 0.8;
        } else {
            // Default Arcade/Simcade handling drift behavior
            const slipAngle = Math.abs(lateralSlip);
            if (slipAngle > 0.15) {
                latFrictionMult = isRearWheel ? (tireFrictionMult * 0.8) : (tireFrictionMult * 0.9); 
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
