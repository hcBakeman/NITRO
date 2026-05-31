import Jolt from 'jolt-physics'; Jolt().then(jolt => { 
  const cl = new jolt.ContactListenerJS();
  console.log('ContactListenerJS keys:', Object.getOwnPropertyNames(jolt.ContactListenerJS.prototype));
});
