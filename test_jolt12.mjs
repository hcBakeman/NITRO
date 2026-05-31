
import Jolt from 'jolt-physics'; 
Jolt().then(jolt => {
  let settings = new jolt.BodyCreationSettings();
  console.log('Default Friction:', settings.mFriction);
  console.log('Default Restitution:', settings.mRestitution);
});

