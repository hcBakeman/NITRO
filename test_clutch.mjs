import * as Jolt from './public/jolt-physics.wasm-compat.js';

async function run() {
    const jolt = await Jolt.default();
    console.log("Jolt initialized");

    const settings = new jolt.WheeledVehicleControllerSettings();
    settings.mEngine.mMaxTorque = 1000.0;
    settings.mTransmission.mClutchStrength = 400.0;
    
    console.log("Settings created", settings.mEngine.mMaxTorque);
    // Is there any assert here?
    
    // What if we try to create a WheeledVehicleController?
    // It's created inside VehicleConstraint.
    // Let's just run test_jolt.mjs with modified clutch strength.
}

run();
