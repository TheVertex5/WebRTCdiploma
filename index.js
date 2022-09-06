'use strict';

var http = require('http');

var os = require('os');
var socketIO = require('socket.io');
//var nodeStatic = require('node-static');
var versionStr = process.version.substring(1);
var version = parseInt(versionStr.split('.')[0]);

var https = require('https');
var path = require('path');
var express = require('express');
var fs = require('fs');


var app = express();
app.use(express.static('js'));
app.use(express.static('css'));

app.get('/client', function(req, res) {
  res.sendFile(path.join(__dirname, '/index.html'));
  console.log('p>> getting client');
  //res.send('Open client');
});
app.get('/host', function(req, res) {
  res.sendFile(path.join(__dirname, '/host_index.html'));
  console.log('p>> getting host');
  //res.send('Open host');
});
app.get('/test', function(req, res) {
  console.log('p>> getting test');
  res.send('Test is succesful');
});

var privateKey  = fs.readFileSync('key.pem', 'utf8');
var certificate = fs.readFileSync('cert.pem', 'utf8');
var credentials = {key: privateKey, cert: certificate};
var httpsServer = https.createServer(credentials, app);
httpsServer.listen(443);


var rooms = {};
var roomsToFile = {};
if (version<10) {
  var io = socketIO(httpsServer, {}); 
  io.listen(httpsServer); 
} else {
  var io = socketIO.listen(httpsServer);
}
io.sockets.on('connection', function(socket) {

  // convenience function to log server messages on the client
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    socket.emit('log', array, socket.id);
  }

  socket.on('message', function(message, room, id, uName) {
    // for a real app, would be room-only (not broadcast)
    if (message == 'got user media') {
      socket.emit('message', message, room, id);
    } else if (message == 'bye') {
      console.log(id + ' has disconnected from room ' + room)
      if (id == rooms[room]) {
        fs.appendFile(roomsToFile[room], 
          'Host disconnected from room at '+(new Date())+'\n',
          function() {
            console.log('logged host disconnect')
          });
        console.log(id + ' was host');
        socket.to(room).emit('message', message, room, id, uName);
        console.log('deleting room ' + room);
        delete rooms[room];
        delete roomsToFile[room];
      } else {
        socket.to(rooms[room]).emit('message', message, room, id, uName);
        var uName = ''; //save Unames?
        if (roomsToFile[room] != undefined) {
          fs.appendFile(roomsToFile[room], 
            'Client '+uName+' disconnected from room at '+(new Date())+'\n',
            function() {
              console.log('logged client disconnect')
            });
        }
      }
    } else {
      if (id != rooms[room]) {
        io.to(rooms[room]).emit('message', message, room, id, uName);
      } else {
        socket.to(room).emit('message', message, room, id, uName);
      }
    }
    //socket.broadcast.emit('message', message, room, role);
  });

  socket.on('chat', function (message, room, id, uName) {
    fs.appendFile(roomsToFile[room], 
      uName+' sent message '+message+' at '+(new Date())+'\n',
      function() {
        console.log('logged chat message')
      });
    socket.to(room).emit('chat', message, room, id, uName);
  });

  socket.on('upload', function(video, room, id, uName) {
    if (id == rooms[room]) {
      // do download
      fs.writeFile('./video/'+room+'_'+dateString()+'/'+uName+'_'+room+'.mp4', 
          video,
          function() {
            console.log('logged upload');
          });
      //console.log('video buffered ', video);
    }
  });

  socket.on('status', function (message, room, id, uName) {
    if (message == 'hand') {
      
      io.to(rooms[room]).emit('status', message, id, uName);

      fs.appendFile(roomsToFile[room], 
        uName+' raised hand at '+(new Date())+'\n',
        function() {
          console.log('logged raised hand')});
    } else if (message == 'muteAll') {
      console.log('send mute all');
      socket.to(room).emit('status', 'mute', room, id, uName);
    } else if (message == 'mute') {
      console.log('send mute focused');
      io.to(id).emit('status', message, room, rooms[room], uName)
    } else if (message == 'unMuteAll') {
      console.log('send unmute all');
      socket.to(room).emit('status', 'unMute', room, id, uName);
    } else if (message == 'unMute') {
      console.log('send unmute focused');
      io.to(id).emit('status', message, room, rooms[room], uName)
    }
  });

  /*socket.on('create or join', function(room) {
    log('Received request to create or join room ' + room);

    var clientsInRoom = io.sockets.adapter.rooms[room];
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');

    if (numClients === 0) {
      socket.join(room);
      rooms[room] = socket.id;
      console.log('Client ID ' + socket.id + ' created room ' + room);
      socket.emit('created', room, socket.id);

    } else if (numClients <= 10) {
      console.log('Client ID ' + socket.id + ' joined room ' + room);
      io.sockets.in(room).emit('join', room, socket.id);
      socket.join(room);
      socket.emit('joined', room);
      //setTimeout(()=>{console.log('Waited');}, 10000);
      socket.to(room).emit('ready', socket.id);
    } else { // max two clients
      socket.emit('full', room);
    }
  });*/

  socket.on('create', function(room) {
    var clientsInRoom = io.sockets.adapter.rooms[room];
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');

    if (!(room in rooms)) {
      socket.join(room);
      rooms[room] = socket.id;
      console.log('Client ID ' + socket.id + ' created room ' + room);
      socket.emit('created', room, socket.id);
      roomsToFile[room] = './event_logs/'+room+'_'+dateString();
      console.log(roomsToFile[room]);
      fs.appendFile(roomsToFile[room], 
          'Room '+room+' created on '+(new Date())+'\n',
          function() {
            console.log('logged create');
          });
    }
  });

  socket.on('join', function(room, uName) {
    var clientsInRoom = io.sockets.adapter.rooms[room];
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');
    if (room in rooms) {
      if (numClients <= 12) {
        console.log('Client ID ' + socket.id + ' joined room ' + room);
        fs.appendFile(roomsToFile[room], 
          'Client '+uName+' joined room at '+(new Date())+'\n',
          function() {
            console.log('logged client connect');
          });
        io.sockets.in(room).emit('join', room, socket.id, uName);
        socket.join(room);
        socket.emit('joined', room);
        socket.to(room).emit('ready', socket.id);
      } else { // max two clients
        socket.emit('full', room);
      }
    } else {
      socket.to(socket.id).emit('message', 'Room '+room+' doesn\'t exist', room, -1);
    }
    
  });

  socket.on('ipaddr', function() {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });

  socket.on('bye', function(){
    console.log('received bye');
    
  });

});

function dateString() {
  var today = new Date();
  var dd = String(today.getDate()).padStart(2, '0');
  var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  var yyyy = today.getFullYear();

  return (mm + '-' + dd + '-' + yyyy);
}
