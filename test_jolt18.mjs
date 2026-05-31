
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let settings = new jolt.WheeledVehicleControllerSettings();
  let trans = settings.mTransmission;
  let ratios = trans.mGearRatios;
  console.log('Ratios size:', ratios.size());
  for(let i=0; i<ratios.size(); i++) {
     console.log('Gear', i+1, 'ratio:', ratios.at(i));
  }
});

