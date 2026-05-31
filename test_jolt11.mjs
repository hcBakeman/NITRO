
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let settings = new jolt.WheeledVehicleControllerSettings();
  console.log('Max Torque:', settings.mEngine.mMaxTorque);
  console.log('Max RPM:', settings.mEngine.mMaxRPM);
  console.log('Clutch:', settings.mTransmission.mClutchStrength);
  console.log('Gear Ratios:', settings.mTransmission.mGearRatios.size());
});

