const { Server } = require('socket.io');

const io = new Server(3000, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const players = {};
let lobbySettings = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('JOIN', (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name,
      carModel: data.carModel,
      loaded: false,
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 }
    };
    
    socket.emit('WELCOME', {
      existingPlayers: players,
      lobbySettings
    });

    socket.broadcast.emit('PLAYER_JOINED', players[socket.id]);
  });

  socket.on('START_RACE', (data) => {
    io.emit('GAME_INIT', {
      seed: data.seed,
      lapCount: data.lapCount,
      driveMode: data.driveMode,
      handlingMode: data.handlingMode,
      gridAssignments: Object.keys(players),
      collisionMode: data.collisionMode
    });
  });

  socket.on('LOADED', () => {
    if (players[socket.id]) players[socket.id].loaded = true;
    io.emit('PLAYER_LOADED', { id: socket.id });
    
    // Check if everyone is loaded
    const allReady = Object.values(players).every(p => p.loaded);
    if (allReady) {
      console.log('All players loaded. Starting countdown...');
      io.emit('START_COUNTDOWN');
    }
  });

  socket.on('ROCKET_FIRE', (data) => {
    console.log('Broadcasting ROCKET_FIRE event from', socket.id);
    io.emit('EVENT_SCHEDULED', {
      type: 'ROCKET_FIRE',
      executeTick: 0,
      data: {
        sourceId: socket.id,
        pos: data.pos,
        quat: data.quat,
        crateIdx: data.crateIdx
      }
    });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('PLAYER_LEFT', { id: socket.id });
    console.log('Client disconnected:', socket.id);
  });
});

console.log('Mock socket server running on port 3000');
