'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var isfilled = false;
var localStream;
var pc;
var remoteStream;
var remoteID;
var turnReady;

var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////


var socket = io.connect();


navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true
})
.then(gotStream)
.catch(function(e) {
  alert('getUserMedia() error: ' + e.name);
});

var room = '';
var uName = '';
while (room=='' || room==null) {
  room = prompt('Enter room name:');
}
while (uName=='' || uName==null) {
  uName = prompt('Enter username name:');
}


socket.on('created', function(room) {
  console.log('Created room ' + room);
  isInitiator = true;
});

socket.on('full', function(room) {
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

socket.on('joined', function(room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

socket.on('log', function(array) {
  console.log.apply(console, array);
});

socket.on('ready', function () {
  console.log('recived ready signal');
});

////////////////////////////////////////////////

function sendMessage(message) {
  console.log('Client sending message: ', message, room, socket.id, uName);
  socket.emit('message', message, room, socket.id, uName);
}

// This client receives a message
socket.on('message', function(message, room, id) {
  console.log('Client received message:', message, '\nin ', room, ' by ', id);
  if (message === 'got user media') {
    console.log('got user media message');
    maybeStart();
  } else if (message.type === 'offer') {
    if (!isStarted) {
      console.log('isnt started and offer');
      maybeStart();
      pc.setRemoteDescription(new RTCSessionDescription(message));
      doAnswer();
    }
    
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    if (remoteID === undefined || id == remoteID) {
      pc.addIceCandidate(candidate);
    }
    if (message.candidate == '' && remoteID === undefined) {
      remoteID = id;
    }
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

socket.on('chat', function(message, room, id, uName) {
  // display message
  console.log('Client got chat message from '+uName+': ', message, room);
  document.getElementById('chatBox').innerHTML += '<b style="color:blue;">'+uName+': </b>'+message+'<br>';
});

socket.on('status', function(message, room, id, uName) {
  console.log('recived status: '+message);
  if (message == 'mute') {
    remoteStream.getAudioTracks()[0].enabled = false;
  } else if (message == 'unMute') {
    remoteStream.getAudioTracks()[0].enabled = true;
  }
});

////////////////////////////////////////////////////

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');



function gotStream(stream) {
  console.log('Adding local stream.');
  if (stream === undefined) {
    console.log('stream is undefined');
    return;
  }
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage('got user media');
  if (isInitiator) {
    maybeStart();
  }
}

var constraints = {
  video: true
};

console.log('Getting user media with constraints', constraints);

if (location.hostname !== 'localhost') {
  requestTurn(
    'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
  );
}

function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
  }
  
}

/*window.onbeforeunload = function() {
  sendMessage('bye');
};*/
window.addEventListener('beforeunload', function(){
  sendMessage('bye');
});

/////////////////////////////////////////////////////////

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(null);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
    isfilled = true;
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall() {
  console.log('Sending offer to peer');
  pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer().then(
    setLocalAndSendMessage,
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          'urls': 'turn:' + turnServer.username + '@' + turnServer.turn,
          'credential': turnServer.password
        });
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  pc.close();
  pc = null;
}

function sendChatMsg() {
  var ta = document.getElementById('chatMsg');
  var chatMsgVal = ta.value;
  ta.value = '';
  console.log('chat', chatMsgVal, room, socket.id);
  document.getElementById('chatBox').innerHTML += '<b style="color:green;">'+uName+': </b>'+chatMsgVal+'<br>';
  socket.emit('chat', chatMsgVal, room, socket.id, uName);
}

function sendStatus(message) {
  socket.emit('status', message, room, socket.id, uName);
}
