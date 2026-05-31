
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let diff = new jolt.VehicleDifferentialSettings();
  console.log('Differential gear ratio:', diff.mEngineTorqueRatio);
  console.log('Wait, mEngineTorqueRatio is torque split. Differential ratio is mGearRatio?');
  console.log('Props:', Object.keys(jolt.VehicleDifferentialSettings.prototype));
  console.log('mDifferentialRatio?', diff.mDifferentialRatio);
});

