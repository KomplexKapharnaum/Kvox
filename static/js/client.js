// nosleep
var noSleep = new NoSleep();

// peer connection
var pc = null;
var dc = null, dcInterval = null;

start_btn = document.getElementById('start');
stop_btn = document.getElementById('stop');
statusField = document.getElementById('status');

function btn_show_stop() {
    start_btn.classList.add('d-none');

    stop_btn.classList.remove('btn-danger');
    stop_btn.classList.add('btn-warning');
    stop_btn.classList.remove('d-none');
}

function btn_show_start() {
    stop_btn.classList.add('d-none');
    
    start_btn.classList.remove('d-none');
    statusField.innerText = 'Press start';
}

function negotiate() {
    return pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
    }).then(function () {
        return new Promise(function (resolve) {
            if (pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                function checkState() {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                }

                pc.addEventListener('icegatheringstatechange', checkState);
            }
        });
    }).then(function () {
        var offer = pc.localDescription;
        console.log(offer.sdp);
        return fetch('/offer', {
            body: JSON.stringify({
                sdp: offer.sdp,
                type: offer.type,
            }),
            headers: {
                'Content-Type': 'application/json'
            },
            method: 'POST'
        });
    }).then(function (response) {
        return response.json();
    }).then(function (answer) {
        console.log(answer.sdp);
        return pc.setRemoteDescription(answer);
    }).catch(function (e) {
        console.log(e);
        btn_show_start();
    });
}

var lineCounter = 0

function performRecvText(str, id) {
    var listDiv = $("#list");
    
    var line = $("<div id='line"+String(lineCounter)+"' class='txt"+String(id%4)+" line editable' contenteditable='true'>").html(str)

    var ctrl = $("<div id='ctrl"+String(lineCounter)+"' class='lineCtrl'>")
        .appendTo(listDiv)


    // var warn = $('<button class="btn btn-warning btn-sm">!</button>')

    var del = $('<button class="btn btn-danger btn-sm">x</button>')
        .appendTo(ctrl)
        .on('click', ()=>{
            line.removeClass('important')
            line.toggleClass('deleted')
            ctrl.toggleClass('deleted')
            del.toggleClass('btn-danger')
            del.toggleClass('btn-secondary')
            // warn.toggle()
        })

    // warn.appendTo(ctrl)
    //     .on('click', ()=>{
    //         line.toggleClass('important')
    //     })

    line.appendTo(listDiv)
    lineCounter += 1
    
    listDiv.scrollTop(listDiv.prop("scrollHeight"));

    document.getElementById('partial'+String(id%4)).innerText = ""
}

function performRecvPartial(str, id) {
    document.getElementById('partial'+String(id%4)).innerText = str
}

function start() {
    noSleep.enable();

    btn_show_stop();
    statusField.innerText = 'Connecting...';
    var config = {
        sdpSemantics: 'unified-plan'
    };

    pc = new RTCPeerConnection(config);

    var parameters = {};

    dc = pc.createDataChannel('chat', parameters);
    dc.onclose = function () {
        clearInterval(dcInterval);
        console.log('Closed data channel');
        btn_show_start();
    };
    dc.onopen = function () {
        console.log('Opened data channel');
    };
    dc.onmessage = function (evt) {
        if(evt.data !== undefined) {
            getData =JSON.parse(evt.data)
            if(getData.text !== undefined) {
                performRecvText(getData.text, getData.id)
            } else if (getData.partial !== undefined) {
                performRecvPartial(getData.partial, getData.id)
            }
            console.log(getData);
        }
        statusField.innerText = 'Listening...';
        stop_btn.classList.remove('btn-warning');
        stop_btn.classList.add('btn-danger');
    };

    pc.oniceconnectionstatechange = function () {
        if (pc.iceConnectionState == 'disconnected') {
            console.log('Disconnected');
            btn_show_start();
        }
    }

    var constraints = {
        audio: true,
        video: false,
    };

    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        stream.getTracks().forEach(function (track) {
            pc.addTrack(track, stream);
        });
        return negotiate();
    }, function (err) {
        console.log('Could not acquire media: ' + err);
        btn_show_start();
    });
}

function stop() {

    // close data channel
    if (dc) {
        dc.close();
    }

    // close transceivers
    if (pc.getTransceivers) {
        pc.getTransceivers().forEach(function (transceiver) {
            if (transceiver.stop) {
                transceiver.stop();
            }
        });
    }

    // close local audio / video
    pc.getSenders().forEach(function (sender) {
        sender.track.stop();
    });

    // close peer connection
    setTimeout(function () {
        pc.close();
    }, 500);
}

function exportTxt() {
    console.log('export')
    var ex = $("<div>");
    $('.line').each( (index, el)=>{
        if ( !$(el).hasClass("deleted") ) 
        {
            ex.append( $( el ).html() )
            ex.append("\n")
        }
    } )
    Export2Doc(ex)
}


$( document ).ready(function() {
    console.log( "ready!" );
    start()    
});