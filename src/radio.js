import { EventEmitter } from 'events';
import Throttle from 'throttle';
import eos from 'end-of-stream';
import { Readable as PcmSilenceReadable } from 'pcm-silence';

// import youtubeSource from './sources/youtube';
import youtubeDlSource from './sources/youtube-dl';
import httpSource from './sources/http';
import pmSource from './sources/playmusic';
import ffmpegFormat from './formats/ffmpeg';
import s16leFormat from './formats/s16le';

import { Readable as MixingReadable } from './live-mixing';

async function findAsync(array, fn) {
    for(const value of array) {
        if(await Promise.resolve(fn(value))) return value;
    }

    return null;
}

export default class Radio extends EventEmitter {
    constructor() {
        super();

        this.mr = new MixingReadable({ highWaterMark: 1024 });

        this.out = this.mr.pipe(new Throttle(44100 * 2 * 2));

        this.playing = false;
        this.urlQueue = [];

        (new PcmSilenceReadable({
            signed: true,
            bitDepth: 16,
            byteOrder: 'LE'
        }))
        .pipe(this.mr.createInputStream());

        this.sources = [
            // youtubeSource,
            youtubeDlSource,
            pmSource,
            httpSource
        ];

        this.formats = [
            s16leFormat,
            ffmpegFormat
        ];

        this.manuallyStopped = false;

        this
        .on('song-start', (url, stream) => {
            this.currentlyPlayingStream = stream;
        })
        .on('song-end', () => {
            this.currentlyPlayingStream = null;
        });
    }

    get isPlaying() {
        return this.currentlyPlayingStream != null;
    }

    async play(url) {
        const source = await findAsync(this.sources, source => source.handles(url));
        console.error('USING SOURCE TYPE:', source.name);

        const input = await Promise.resolve(source.getStream(url));

        const format = await findAsync(this.formats, format => format.handles(input));
        console.error('USING FORMAT TYPE:', format.name);

        const outStream = this.mr.createInputStream();
        format.transformFormat(input, outStream);

        this.emit('song-start', url, outStream);
        eos(outStream, (err) => {
            if(err) return this.emit('error', err);

            this.emit('song-end', url, outStream, this.manuallyStopped);
            this.manuallyStopped = false;
        });
    }

    stop() {
        if(!this.currentlyPlayingStream) return;

        this.manuallyStopped = true;
        this.currentlyPlayingStream.end();
    }
}
