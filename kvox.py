#!/usr/bin/env python3

import json
import logging
import ssl
import sys
import time
import os
import concurrent.futures
import asyncio

from pathlib import Path
from vosk import KaldiRecognizer, Model
from aiohttp import web
from aiohttp.web_exceptions import HTTPServiceUnavailable
from aiortc import RTCSessionDescription, RTCPeerConnection
from av.audio.resampler import AudioResampler

ROOT = Path(__file__).parent

vosk_interface = os.environ.get('VOSK_SERVER_INTERFACE', '0.0.0.0')
vosk_port = int(os.environ.get('VOSK_SERVER_PORT', 2700))
vosk_model_path = os.environ.get('VOSK_MODEL_PATH', 'model')

model = Model(vosk_model_path)
pool = concurrent.futures.ThreadPoolExecutor((os.cpu_count() or 1))

allchannels = []
allIds = 0

def process_chunk(rec, message):
    if rec.AcceptWaveform(message):
        o = json.loads(rec.Result())
        if 'text' in o.keys() and o['text']:
            return o
    else:
        o = json.loads(rec.PartialResult())
        if 'partial' in o.keys() and o['partial']:
            return o
    return None

class KaldiTask:
    def __init__(self, user_connection):
        global allIds
        self.__id = allIds
        allIds += 1
        
        self.__resampler = AudioResampler(format='s16', layout='mono', rate=48000)
        self.__pc = user_connection
        self.__audio_task = None
        self.__pushback_task = None
        self.__track = None
        self.__channel = None
        self.__recognizer = KaldiRecognizer(model, 48000)
        self.loop = asyncio.get_event_loop()


    async def set_audio_track(self, track):
        self.__track = track

    async def set_text_channel(self, channel):
        self.__channel = channel

    async def start(self):
        self.__audio_task = asyncio.create_task(self.__run_audio_xfer())

    async def stop(self):
        if self.__audio_task is not None:
            self.__audio_task.cancel()
            self.__audio_task = None

    async def __run_audio_xfer(self):
        dataframes = bytearray(b"")
        while True:
            frame = await self.__track.recv()
            frame = self.__resampler.resample(frame)
            max_frames_len = 8000
            message = frame.planes[0].to_bytes()
            recv_frames = bytearray(message)
            dataframes += recv_frames
            if len(dataframes) > max_frames_len:
                wave_bytes = bytes(dataframes)
                response = await self.loop.run_in_executor(pool, process_chunk, self.__recognizer, wave_bytes)
                
                # print(response)
                if response:
                    
                    response['id'] = self.__id
                    resJson = json.dumps(response)
                    
                    if self.__channel:
                        self.__channel.send(resJson)
                        await self.__channel._RTCDataChannel__transport._data_channel_flush()
                        await self.__channel._RTCDataChannel__transport._transmit()
                    
                    for chan in allchannels[:]:
                        try:
                            chan.send(resJson)
                            await chan._RTCDataChannel__transport._data_channel_flush()
                            await chan._RTCDataChannel__transport._transmit()
                        except:
                            allchannels.remove(chan)
                
                dataframes = bytearray(b"")


async def index(request):
    content = open(str(ROOT / 'static' / 'index.html')).read()
    return web.Response(content_type='text/html', text=content)


async def offer(request):

    params = await request.json()
    offer = RTCSessionDescription(
        sdp=params['sdp'],
        type=params['type'])

    pc = RTCPeerConnection()

    kaldi = KaldiTask(pc)

    @pc.on('datachannel')
    async def on_datachannel(channel):
        # await kaldi.set_text_channel(channel)
        global allchannels
        allchannels.append(channel)
        await kaldi.start()
        
        channel.send(json.dumps({}))
        await channel._RTCDataChannel__transport._data_channel_flush()
        await channel._RTCDataChannel__transport._transmit()

    @pc.on('iceconnectionstatechange')
    async def on_iceconnectionstatechange():
        if pc.iceConnectionState == 'failed':
            await pc.close()

    @pc.on('track')
    async def on_track(track):
        if track.kind == 'audio':
            await kaldi.set_audio_track(track)

        @track.on('ended')
        async def on_ended():
            await kaldi.stop()

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)


    return web.Response(
        content_type='application/json',
        text=json.dumps({
            'sdp': pc.localDescription.sdp,
            'type': pc.localDescription.type
        }))


if __name__ == '__main__':

    #ssl_context = ssl.SSLContext()
    #ssl_context.load_cert_chain('kvox.crt', 'kvox.key')
    ssl_context = None

    app = web.Application()
    app.router.add_post('/offer', offer)

    app.router.add_get('/', index)
    app.router.add_static('/static/', path=ROOT / 'static', name='static')

    web.run_app(app, port=vosk_port, ssl_context=ssl_context)
