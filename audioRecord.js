const gainValue = {
    volumeValue: 50
}

class AudioRecord {
    constructor(option = {
        onAudioProcess: () => { },
        onStartRecord: () => { },
        onError: () => { },
        onStopRecord: () => { },
        interval: 0,
        recordRequest: () => {}
        // onErrSupport: () => { }
    }) {
        this.option = Object.assign({}, option, {
            channelCount: 1,
            numberOfInputChannels: 1,
            numberOfOutputChannels: 1,
            sampleBits: 16,
            sampleRate: 16000,
            bufferSize: 4096
        })
        this.audioCtx = null
        this.mediaNode = null
        this.gainNode = null
        this.analyser = null
        this.jsNode = null

        this.timer = null

        this.buffer = []
        this.size = 0
    }
    stopRecord() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        
        this.mediaNode.disconnect()
        this.gainNode.disconnect()
        this.analyser.disconnect()
        this.jsNode.disconnect()

        //关闭上下文
        this.audioCtx.close()
        
        this.option.onStopRecord(new Blob([this.covertWav()], { type: 'audio/wav' }))

    }
    record() {

        if (navigator.mediaDevices === undefined) {
            navigator.mediaDevices = {}
        }

        if (navigator.mediaDevices.getUserMedia === undefined) {
            navigator.mediaDevices.getUserMedia = function (constraints) {
                var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia
                if (!getUserMedia) {
                    // this.option.onErrSupport()
                    return Promise.reject('浏览器暂不支持')
                }
                return new Promise(function (resolve, reject) {
                    getUserMedia.call(navigator, constraints, resolve, reject)
                })
            }
        }



        navigator.mediaDevices.getUserMedia({
            audio: true
        }).then(mediaStream => {
            this.option.onStartRecord()
            this.beginRecord(mediaStream)
        }).catch(err => {
            this.option.onError(err)
        })
    }

    //录音触发事件
    // 并且由于不给outputBuffer设置内容，所以扬声器不会播放出声音
    onAudioProcess(event, analyser) {
        let audioBuffer = event.inputBuffer

        let data = audioBuffer.getChannelData(0)
        this.buffer.push(new Float32Array(data))

        let dataArr = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(dataArr)
        // console.log(dataArr, 'dataArr')
        this.size += data.length
        this.option.onAudioProcess(dataArr)
    }

    getRawData() { //合并压缩  
        //合并
        let data = new Float32Array(this.size)
        let offset = 0
        for (let i = 0; i < this.buffer.length; i++) {
            data.set(this.buffer[i], offset)
            offset += this.buffer[i].length
        }
        // 压缩
        let getRawDataion = parseInt(this.audioCtx.sampleRate / this.option.sampleRate)
        let length = data.length / getRawDataion
        let result = new Float32Array(length)
        let index = 0, j = 0
        while (index < length) {
            result[index] = data[j]
            j += getRawDataion
            index++
        }
        //每次生成文件 则重置缓存数据
        this.buffer = []
        this.size = 0
        return result
    }
    reshapeWavData(sampleBits, offset, iBytes, oData) { // 8位采样数位
        if (sampleBits === 8) {
            for (let i = 0; i < iBytes.length; i++ , offset++) {
                let s = Math.max(-1, Math.min(1, iBytes[i]))
                let val = s < 0 ? s * 0x8000 : s * 0x7FFF
                val = parseInt(255 / (65535 / (val + 32768)))
                oData.setInt8(offset, val, true)
            }
        } else {
            for (let i = 0; i < iBytes.length; i++ , offset += 2) {
                let s = Math.max(-1, Math.min(1, iBytes[i]))
                oData.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
            }
        }
        return oData
    }

    covertWav() { // 转换成wav文件数据
        let sampleRate = Math.min(this.audioCtx.sampleRate, this.option.sampleRate)
        let sampleBits = Math.min(16, this.option.sampleBits)
        let bytes = this.getRawData()
        let dataLength = bytes.length * (sampleBits / 8)
        let buffer = new ArrayBuffer(44 + dataLength)
        let data = new DataView(buffer)
        let offset = 0
        let writeString = function (str) {
            for (var i = 0; i < str.length; i++) {
                data.setUint8(offset + i, str.charCodeAt(i))
            }
        }
        // 资源交换文件标识符   
        writeString('RIFF'); offset += 4
        // 下个地址开始到文件尾总字节数,即文件大小-8   
        data.setUint32(offset, 36 + dataLength, true); offset += 4
        // WAV文件标志  
        writeString('WAVE'); offset += 4
        // 波形格式标志   
        writeString('fmt '); offset += 4
        // 过滤字节,一般为 0x10 = 16   
        data.setUint32(offset, 16, true); offset += 4
        // 格式类别 (PCM形式采样数据)   
        data.setUint16(offset, 1, true); offset += 2
        // 通道数   
        data.setUint16(offset, this.option.channelCount, true); offset += 2
        // 采样率,每秒样本数,表示每个通道的播放速度   
        data.setUint32(offset, sampleRate, true); offset += 4
        // 波形数据传输率 (每秒平均字节数) 单声道×每秒数据位数×每样本数据位/8   
        data.setUint32(offset, this.option.channelCount * sampleRate * (sampleBits / 8), true); offset += 4
        // 快数据调整数 采样一次占用字节数 单声道×每样本的数据位数/8   
        data.setUint16(offset, this.option.channelCount * (sampleBits / 8), true); offset += 2
        // 每样本数据位数   
        data.setUint16(offset, sampleBits, true); offset += 2
        // 数据标识符   
        writeString('data'); offset += 4
        // 采样数据总数,即数据总大小-44   
        data.setUint32(offset, dataLength, true); offset += 4
        // 写入采样数据
        data = this.reshapeWavData(sampleBits, offset, bytes, data)
        return data
    }

    //开始录制
    beginRecord(mediaStream) {
        this.buffer = []
        this.size = 0
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        this.mediaNode = this.audioCtx.createMediaStreamSource(mediaStream)

        //连接音量
        this.gainNode = this.audioCtx.createGain()

        this.gainNode.gain.value = gainValue.volumeValue
        this.mediaNode.connect(this.gainNode)

        //连接分析器
        this.analyser = this.audioCtx.createAnalyser()
        this.analyser.fftSize = 256


        //把音量连接到分析器
        this.gainNode.connect(this.analyser)


        // 创建一个jsNode
        this.jsNode = this.audioCtx.createScriptProcessor(this.option.bufferSize, this.option.channelCount, this.option.channelCount)
        this.analyser.connect(this.jsNode)

        // 需要连到扬声器消费掉outputBuffer，process回调才能触发
        //连接扬声器
        this.jsNode.connect(this.audioCtx.destination)

        this.jsNode.onaudioprocess = (event) => {
            this.onAudioProcess(event, this.analyser)
        }

        //定时生成文件
        if (this.option.interval) {
            this.timer = setInterval(() => {
                this.option.recordRequest(new Blob([this.covertWav()], { type: 'audio/wav' }))
            }, this.option.interval * 1000)
        }
    }
}

export default AudioRecord

export {
    gainValue
}