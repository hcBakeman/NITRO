import Jolt from 'jolt-physics'; Jolt().then(jolt => { console.log(Object.getOwnPropertyNames(jolt.Quat.prototype)); });
