
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  console.log('Transmission props:', Object.keys(jolt.VehicleTransmission.prototype));
});

