
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let settings = new jolt.WheeledVehicleControllerSettings();
  console.log('Engine min RPM:', settings.mEngine.mMinRPM);
  console.log('Engine max RPM:', settings.mEngine.mMaxRPM);
  let g = settings.mTransmission.mGearRatios;
  let arr = [];
  for(let i=0; i<g.size(); i++) arr.push(g.at(i));
  console.log('Gear Ratios:', arr);
  console.log('Reverse Gear:', settings.mTransmission.mReverseGearRatio);
  console.log('Switch Time:', settings.mTransmission.mSwitchTime);
  console.log('Shift Up RPM:', settings.mTransmission.mShiftUpRPM);
  console.log('Shift Down RPM:', settings.mTransmission.mShiftDownRPM);
});

