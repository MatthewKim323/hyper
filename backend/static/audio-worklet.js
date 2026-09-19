class PCM extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];}
 process(inputs){const data=inputs[0]?.[0];if(data){for(const x of data)this.samples.push(Math.max(-1,Math.min(1,x)));while(this.samples.length>=1280){const chunk=this.samples.splice(0,1280);const bytes=new ArrayBuffer(2560);const v=new DataView(bytes);chunk.forEach((x,i)=>v.setInt16(i*2,Math.round(x*32767),true));this.port.postMessage(bytes,[bytes]);}}return true;}
}
registerProcessor('pcm',PCM);
