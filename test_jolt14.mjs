
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let settings = new jolt.WheeledVehicleControllerSettings();
  console.log('Clutch strength:', settings.mTransmission.mClutchStrength);
});

