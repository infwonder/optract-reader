'use strict';

const fs = require('fs');
const repl = require('repl');
const path = require('path');
const figlet = require('figlet');

// ASCII Art!!!
const ASCII_Art = (word) => {
        const _aa = (resolve, reject) => {
                figlet(word, {font: 'Big'}, (err, data) => {
                        if (err) return reject(err);
                        resolve(data);
                })
        }

        return new Promise(_aa);
}

// Handling promises in REPL (for node < 10.x)
const replEvalPromise = (cmd,ctx,filename,cb) => {
  let result=eval(cmd);
  if (result instanceof Promise) {
    return result.then(response=>cb(null,response))
                 .catch((err) => { console.trace(err); cb(null,undefined) });
  }
  return cb(null, result);
}

//Main
var srv = process.argv[2]; 
var opt;
var r;
var title = 'Optract: Ops Console';

const WSClient = require('rpc-websockets').Client;
const connectRPC = (url) => {
	opt = new WSClient(url);

	const __ready = (resolve, reject) =>
	{
		opt.on('open',  function(event) { resolve(true) });
		opt.on('error', function(error) { console.trace(error); reject(false) });
	}

	return new Promise(__ready);
}

return connectRPC(srv)
 .then((rc) => 
 {
	if (!rc) throw("failed connection");

	title = 'Optract: WS Console';
	let p = [ ASCII_Art(title) ];
	return Promise.all(p).then((rc) => {
		let art = rc[1];
		console.log(art);
		r = repl.start({ prompt: `[-= ${'OptractWsRPC'} =-]$ `, eval: replEvalPromise });
		r.context = {opt};
		r.on('exit', () => {
			console.log("\n\t" + 'Stopping WSRPC CLI...');
			opt.close();
		})
	})
 })
 .catch((err) => { console.trace(err); })
