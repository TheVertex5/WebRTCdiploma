'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
//var pc;
//var pc2;
//var remoteStream;
//var remoteStream2;
//var isFree = true;
var turnReady;
var curActiveID;

var pcs = {}; // socketID String -> peerconnection Object
var remoteStreams = {}; // socketID String -> stream Object
var remoteVideoDOMs = []; // i Integer (vezan na DOM objekt) -> socketID String
var uNameID = {}; // socketID String -> username String

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

addEventListener('beforeunload', event => {
  hangup();
})

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
room = prompt('Enter room name:'); 

var socket = io.connect();

if (room !== '') {
  document.getElementById('headerText').innerText = 'Host of room '+room;
  socket.emit('create', room);
  console.log('Attempted to create or  join room', room);
}

socket.on('created', function(room) {
  console.log('Created room ' + room);
  isInitiator = true;
});

socket.on('full', function(room) {
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (room, id, uName){
  console.log('Another peer ' + id + ' made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  uNameID[id] = uName;
  isChannelReady = true;
});

socket.on('joined', function(room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

socket.on('log', function(array, id) {
  console.log.apply(console, array);
  console.log('sent by ', id);
});

socket.on('ready', function (id) {
  console.log('recived ready signal triggered by ', id);
  maybeStart(id);
});


////////////////////////////////////////////////

function sendMessage(message) {
  console.log('Client sending message: ', message, room);
  socket.emit('message', message, room, socket.id);
}

// This client receives a message
socket.on('message', function(message, room, id) {
  console.log('Client received message:', message, '\nin ', room, ' by ', id);
  if (message === 'got user media') {
    maybeStart(id);
    console.log('step 2: ACK')
  } else if (message.type === 'answer' && isStarted) {
    //maybeStart(id);
    pcs[id].setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pcs[id].addIceCandidate(candidate);
    /*if (message.candidate == '') {
      console.log('isFree ', isFree, ' to ', false);
      isFree = false;
    }*/
    
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup(id);
  }
});

//////////////////////////////////////////////////// encircledtofight

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');
var remoteStream2 = document.querySelector('#remoteVideo2');

navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true
})
.then(gotStream)
.catch(function(e) {
  alert('getUserMedia() error: ' + e.name);
});

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage('got user media');
  if (isInitiator) {
    maybeStart(socket.id);
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

function maybeStart(id) {
  console.log('>>>>>>> maybeStart() ', localStream, isChannelReady, id);
  if (typeof localStream !== 'undefined' && isChannelReady) {
    
    createPeerConnection(id);
    pcs[id].addStream(localStream);
    isStarted = true;
    console.log('maybeStart does call');
    doCall(id);
  }
}

window.onbeforeunload = function() {
  sendMessage('bye');
};

/////////////////////////////////////////////////////////

function createPeerConnection(id) {
  try {
    pcs[id] = new RTCPeerConnection(null);
    pcs[id].onicecandidate = handleIceCandidate;
    pcs[id].onaddstream = handleRemoteStreamAdded;
    pcs[id].onremovestream = handleRemoteStreamRemoved;
    console.log('pcs: ', pcs);
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
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall(id) {
  console.log('Sending offer to peer');
  curActiveID = id;
  pcs[id].createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer(id) {
  console.log('Sending answer to peer.');
  curActiveID = id;
  pcs[id].createAnswer().then(
    setLocalAndSendMessage,
    onCreateSessionDescriptionError
  );  
}

function setLocalAndSendMessage(sessionDescription) {
  console.log('setLocal ', curActiveID);
  pcs[curActiveID].setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
  curActiveID = undefined;
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
  var id = Object.keys(pcs).find(key => pcs[key] === this);
  remoteStreams[id] = event.stream;
  var len = remoteVideoDOMs.length;
  remoteVideoDOMs[len] = id;
  remoteVideo = document.getElementById('remoteVideo'+len);
  remoteVideo.srcObject = remoteStreams[id];
  
  var videoLabel = document.getElementById('videoLabel'+len);
  videoLabel.classList.remove('invisible');
  videoLabel.innerHTML = uNameID[id];

  console.log('post add');
  console.log(0, pcs);
  console.log(1, remoteStreams);
  console.log(2, remoteVideoDOMs);
  console.log(3, uNameID);
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup(id) {
  console.log('Connection terminated by ', id);
  stop(id);
  isInitiator = false;
}

function stop(id) {
  // remove stopped data
  remoteStreams[id] = null;
  pcs[id].close();
  pcs[id] = null;
  delete pcs[id];
  delete remoteStreams[id];
  var index = remoteVideoDOMs.indexOf(id);
  if (index>-1) {
    remoteVideoDOMs.splice(index, 1);
  }
  delete uNameID[id];

  // empty all elements
  for (let i = 0; i < 12; i++) {
    var stoppingVideo = document.querySelector('#remoteVideo'+i);
    stoppingVideo.srcObject = null;
    var stoppingLabel = document.querySelector('#videoLabel'+i);
    stoppingLabel.classList.add('invisible');
    stoppingLabel.innerHTML = '';
  }

  // sort and reapply to DOMs
  for (let i = 0; i < remoteVideoDOMs.length; i++) {
    var sID = remoteVideoDOMs[i];
    document.querySelector('#remoteVideo'+i).srcObject = remoteStreams[sID];
    var addLabel = document.querySelector('#videoLabel'+i);
    addLabel.classList.remove('invisible');
    addLabel.innerHTML = uNameID[sID];
  }

  console.log('post remove')
  console.log(0, pcs);
  console.log(1, remoteStreams);
  console.log(2, remoteVideoDOMs);
  console.log(3, uNameID);
}

function nameToPosition(elementName) {
  var idStr = elementName.substr(11);
  return parseInt(idStr);
}

function focusStream(domid) {
  console.log(0, remoteStreams[remoteVideoDOMs[nameToPosition(domid)]]);
  localVideo.srcObject = remoteStreams[remoteVideoDOMs[nameToPosition(domid)]];
  document.querySelector('#btnUnFocus').classList.remove('disabled');
}

function unFocusStream() {
  localVideo.srcObject = localStream;
  document.querySelector('#btnUnFocus').classList.add('disabled');
}

function muteAllToggle() {
  var button = document.getElementById('muteAll');
  var button2 = document.getElementById('muteFocused');
  if (button.classList.contains('fa-microphone')) {
    // is active
      // mute self on all
      localStream.getAudioTracks()[0].enabled = false;
      // update button to unmute
      button.classList.remove('fa-microphone');
      button.classList.remove('btn-success');
      button.classList.add('fa-microphone-slash');
      button.classList.add('btn-outline-danger');
      // activate muteFocused button
      button2.classList.remove('fa-microphone');
      button2.classList.remove('btn-success');
      button2.classList.add('fa-microphone-slash');
      button2.classList.add('btn-outline-danger');
      button2.classList.remove('disabled');
  } else if (button.classList.contains('fa-microphone-slash')) {
    // is deactivated
      // unmute on all
      localStream.getAudioTracks()[0].enabled = true;
      // update button to unmute
      button.classList.remove('fa-microphone-slash');
      button.classList.remove('btn-outline-danger');
      button.classList.add('fa-microphone');
      button.classList.add('btn-success');
      // deactivate muteFocused button
      button2.classList.remove('fa-microphone-slash');
      button2.classList.remove('btn-outline-danger');
      button2.classList.add('fa-microphone');
      button2.classList.add('btn-success');
      button2.classList.add('disabled');
  } else {
    // error
  }
}
