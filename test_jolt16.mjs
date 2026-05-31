
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  console.log('Engine props:', Object.keys(jolt.VehicleEngine.prototype));
  console.log('Controller props:', Object.keys(jolt.WheeledVehicleController.prototype));
});

