'use strict';

const fs = require('fs');
const path = require('path');
const PubSubNode = require('./pubsubNode.js');
const OptractMedia = require('../dapps/OptractMedia/OptractMedia.js');
const ipfsClient = require('ipfs-http-client');
const mr = require('@postlight/mercury-parser');
const bs58 = require('bs58');
const ethUtils = require('ethereumjs-utils');
const WSServer = require('rpc-websockets').Server;
const mkdirp = require('mkdirp');

//configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '/../dapps', 'config.json')).toString()); // can become part of cfgObj

// Common Tx
const mfields =
[
        {name: 'opround', length: 32,   allowLess: true, default: Buffer.from([]) },  // opround integer
        {name: 'account', length: 20,   allowZero: true, default: Buffer.from([]) },  // user (autherized) address
        {name: 'comment', length: 32,   allowLess: true, default: Buffer.from([]) },  // ipfs hash (comment)
        {name:   'title', length: 1024, allowLess: true, allowZero: true, default: Buffer.from([]) },  // article title
        {name:     'url', length: 1024, allowLess: true, allowZero: true, default: Buffer.from([]) },  // article url
        {name:     'aid', length: 32,   allowZero: true, default: Buffer.from([]) },  // sha256(title+domain), bytes32
        {name:     'oid', length: 32,   allowLess: true, default: Buffer.from([]) },  // participating game round ID, bytes32
        {name: 'v1block', length: 32,   allowLess: true, default: Buffer.from([]) },  // 1st vote block
        {name:  'v1leaf', length: 32,   allowLess: true, default: Buffer.from([]) },  // 1st vote txhash
        {name: 'v2block', length: 32,   allowLess: true, default: Buffer.from([]) },  // 2nd vote (claim) block
        {name:  'v2leaf', length: 32,   allowLess: true, default: Buffer.from([]) },  // 2nd vote (claim) txhash
        {name:   'since', length: 32,   allowLess: true, default: Buffer.from([]) },  // timestamp, uint
        {name: 'v1proof', length: 768,  allowLess: true, allowZero: true, default: Buffer.from([]) },  // 1st vote merkle proof
        {name:  'v1side', length: 3,    allowLess: true, allowZero: true, default: Buffer.from([]) },  // 1st vote merkle proof (side)
        {name: 'v2proof', length: 768,  allowLess: true, allowZero: true, default: Buffer.from([]) },  // 2nd vote merkle proof
        {name:  'v2side', length: 3,    allowLess: true, allowZero: true, default: Buffer.from([]) },  // 2nd vote merkle proof (side)
        {name:  'txhash', length: 32,   allowZero: true, default: Buffer.from([]) },  // txhash
        {name:       'v', allowZero: true, default: Buffer.from([0x1c]) },
        {name:       'r', allowZero: true, length: 32, default: Buffer.from([]) },
        {name:       's', allowZero: true, length: 32, default: Buffer.from([]) }
];

const pfields =
[
        {name: 'nonce', length: 32, allowLess: true, default: Buffer.from([]) },
        {name: 'pending', length: 32, allowLess: true, default: Buffer.from([]) },
        {name: 'validator', length: 20, allowZero: true, default: Buffer.from([]) },
        {name: 'cache', length: 32, allowLess: true, default: Buffer.from([]) }, // ipfs hash of [txhs, txpd, txdt]
        {name: 'since', length: 32, allowLess: true, default: Buffer.from([]) },
        {name: 'v', allowZero: true, default: Buffer.from([0x1c]) },
        {name: 'r', allowZero: true, length: 32, default: Buffer.from([]) },
        {name: 's', allowZero: true, length: 32, default: Buffer.from([]) }
];

// Random array element pick utils
const __random_avoid = (n,i) => {
	if(n === 1) return i;
	let t = Math.floor(Math.random()*(n));
	if(t === i) {
		return __random_avoid(n,i) 
	} else { 
		return t;
	}
}    

const __random_index = (m,n) =>
{
	return (new Array(m)).fill(undefined).map((_, i) => { return __random_avoid(n,i) });
}

const __random_picks = (m, array) => // random select m elements out of an array
{
	let n = array.length - 1;
	if (n+1 <= m) return array;
	return __random_index(m,n).reduce((c, i) => { c.push(array[i]); return c; }, []);
}

//Main
class OptractNode extends PubSubNode {
	constructor(cfgObj) {
		super(cfgObj);

		this.appCfgs = { ...config }; // can become part of cfgObj
		this.appName = 'OptractMedia';

		const Ethereum = new OptractMedia(this.appCfgs);

		const mixins = 
		[
		   'clearCache',
		   'call', 
		   'ethNetStatus',
		   'linkAccount',
		   'allAccounts',
                   'connected',
                   'configured',
                   'memberStatus',
		   'verifySignature',
		   'validateMerkleProof',
		   'getBlockNo',
		   'getBlockInfo',
		   'getMaxVoteTime1',
		   'getMaxVoteTime2',
		   'getOpround',
		   'getOproundId',
		   'getOproundInfo',
		   'getOproundResults',
		   'getOproundProgress',
		   'getOproundLottery',
		   'getMinSuccessRate',
		   'isValidator'
		];		

		mixins.map((f) => { if (typeof(this[f]) === 'undefined' && typeof(Ethereum[f]) === 'function') this[f] = Ethereum[f] });

		this.networkID = Ethereum.networkID;
		this.abi = Ethereum.abi;

		Ethereum.linkAccount(this.appName)(this.appCfgs.dapps[this.appName].account);
		this.userWallet = Ethereum.userWallet;

		// IPFS related
		this.ipfs = new ipfsClient('gateway.ipfs.io', '5001', {protocol: 'https'}); //FIXME: need to setup onReady event for IPFS

		this.get = (ipfsPath) => { return this.ipfs.cat(ipfsPath) }; // returns promise that resolves into Buffer

		this.validIPFSHash = (ipfsHash) =>
		{
			// currently all ipfsHash we have are Qm... so we only check length
			//console.log(bs58.decode(ipfsHash).slice(2).length);
			let d = bs58.decode(ipfsHash);
			if (d.hexSlice(0,1) !== '12') return false;
			let len = parseInt(d.hexSlice(1,2),16);
			return bs58.decode(ipfsHash).slice(2).length === len;
		}

		// IPFS string need to convert to bytes32 in order to put in smart contract
                this.IPFSstringtoBytes32 = (ipfsHash) =>
                {
			if (!this.validIPFSHash(ipfsHash)) console.error(`IPFSstringtoBytes32: ${ipfsHash} use unsupported multihash`);
                        // return '0x'+bs58.decode(ipfsHash).toString('hex').slice(4);  // return string
                        return ethUtils.bufferToHex(bs58.decode(ipfsHash).slice(2));  // slice 2 bytes = 4 hex  (the 'Qm' in front of hash)
                }

                this.Bytes32toIPFSstring = (hash) =>  // hash is a bytes32 Buffer or hex string (w/wo '0x' prefix)
                {
		        let buf = this._getBuffer(hash);
			if (buf.length != 32) console.error(`Bytes32toIPFSstring: length of input hex ${buf.toString('hex')} is not bytes32`);
                        return bs58.encode(Buffer.concat([Buffer.from([0x12, 0x20]), this._getBuffer(hash)]))
                }

                this._getBuffer = (value) => {
                        if (value instanceof Buffer) {
                                return value;
                        } else if (this._isHex(value)) {
                                return Buffer.from(value, 'hex');
                        } else if (this._isHex(value.slice(2)) && value.substr(0,2) === '0x') {
                                return Buffer.from(value.slice(2), 'hex');
                        } else { // the value is neither buffer nor hex string, will not process this, throw error
                                throw new Error("Bad hex value - '" + value + "'");
                        }
                };

                this._isHex = (value) =>  {
                        let hexRegex = /^[0-9A-Fa-f]{2,}$/;
                        return hexRegex.test(value);
                };

		// Event related		
		this.myStamp = Math.floor(Date.now() / 1000);
		this.myTick  = ( this.myStamp - (this.myStamp % 300) ) / 300; // Optract Epoch No.
		this.pending = { txdata: {}, payload: {}, txhash: {}, nonces: {} };
		this.lostChunk = [];
		this.myEpoch = 0; // Optract block No.

		this.aidWatch = {};
		this.clmWatch = {};

		this.game = { drawed: false, opround: -1, oid: '0x', 
			      aid2vc: {}, aid2cc: {}, aidUrl: {}, 
			      curated: {}, voted: {}, votWatch: {},
			      clmWatch: {}, vbkAid: {}, opSync: -1
		}; 

		this.infuraLB = {
			'4': [
				'https://rinkeby.infura.io/v3/abf050ddd1334730b9e8071ab1a09090',
				'https://rinkeby.infura.io/v3/5d9155406ef3490b8c25eb499b8f7cc0',
				'https://rinkeby.infura.io/v3/f039330d8fb747e48a7ce98f51400d65',
                                'https://rinkeby.infura.io/v3/dc30ca8fb7824f42976ece0e74884807',
                                'https://rinkeby.infura.io/v3/97c8bf358b9942a9853fab1ba93dc5b3',        
                                'https://rinkeby.infura.io/v3/e1967f2f27e143c3b8831d0e612bc7b1',
                                'https://rinkeby.infura.io/v3/42e30346ab5d41c7850f45adedfc9db2',
                                'https://rinkeby.infura.io/v3/e5a3e9ed05704633b5807ca180e71f16',
                                'https://rinkeby.infura.io/v3/d10118fb82354e38aa7e18bf306bd82a',
                                'https://rinkeby.infura.io/v3/6731392aff054ac394819096e01b4c8e',
                                'https://rinkeby.infura.io/v3/e58d5891ebaf464dbcad6a926a107adf',
                                'https://rinkeby.infura.io/v3/dc22c9c6245742069d5fe663bfa8a698',
                                'https://rinkeby.infura.io/v3/c02fff6b5daa434d8422b8ece54c7286',
                                'https://rinkeby.infura.io/v3/027bb869b03f4456aa1e9d13aa1f6506',
                                'https://rinkeby.infura.io/v3/8ec0911ee74c4583b1346bbc1afdf22d',
                                'https://rinkeby.infura.io/v3/e2912103fb8c443ab328f186c14d2ae2',
                                'https://rinkeby.infura.io/v3/f50fa6bf08fb4918acea4aadabb6f537',
                                'https://rinkeby.infura.io/v3/b99594e2edae4ea3bf0f1946921074dc',
                                'https://rinkeby.infura.io/v3/14470f78e2cc459d877bb629fdc5703a'
			]
		};

		const __infuraLB = () =>
		{
			let src = this.infuraLB[this.networkID];
			let avoid = src.indexOf(Ethereum.rpcAddr);
			let newpick = src[__random_avoid(src.length, avoid)];

			if (Ethereum.switchProvider(newpick) === false) {
				this.infuraLB[this.networkID].splice(this.infuraLB[this.networkID].indexOf(newpick),1);
				console.log(`DEBUG: badsrc: ${newpick}`)
			} else {
				console.log(`DEBUG: __infuraLB: new infura address is: ${Ethereum.rpcAddr}`);
			}
		}

		const observer = (sec = 300000) =>
		{
			if ( typeof(this.appCfgs.dapps[this.appName].account) === 'undefined'
			  || typeof(this.userWallet[this.appName]) === 'undefined'
			) {
				console.log(`DEBUG: user account not set, do nothing ...`)
				return setTimeout(observer, 5000, sec);
			}

			const __observe = () => 
			{
				__infuraLB();
				this.myStamp = Math.floor(Date.now() / 1000);
				this.myTick  = ( this.myStamp - (this.myStamp % 300) ) / 300;

				// to perform event at boot time
				let init = false;
				this.clearCache(`${this.appName}_BlockRegistry_getBlockNo`);

				this.getBlockNo().then((rc) => {
					if (rc > this.myEpoch) {
						console.log(`DEBUG: New block found! Clearing Eth_Call caches...`);
						this.clearCache(`${this.appName}_BlockRegistry_queryOpRoundInfo_0`);
						this.clearCache(`${this.appName}_BlockRegistry_queryOpRoundResult_${this.game.opround}`);
						this.clearCache(`${this.appName}_BlockRegistry_queryOpRoundProgress`);
						this.clearCache(`${this.appName}_BlockRegistry_queryOpRoundLottery_${this.game.opround}`);
					}

					let p = [
						Promise.resolve(rc),
						this.getOproundInfo().then((rc1) => {
							let op = rc1[0];
							return this.getOproundLottery(op).then((rc2) => {
								return [...rc1, ...rc2];
							})
						})
					];

					return Promise.all(p);
				}).then((rc) => {
					let newEpoch = rc[0];
					let newOpRnd = rc[1][0];
					let oid      = rc[1][1];
					let opStart  = rc[1][2];
					let opDraw   = rc[1][4];

					if (this.game.opround === -1) {
						this.game.opround = newOpRnd;
						this.game.opStart = opStart;
						init = true;
					}

					let chkClm = false;
					if (newOpRnd > this.game.opround && newOpRnd >= 1) {
						// reset this.game
						this.game = { 
							drawed: opDraw > 0 ? true : false, 
							opround: newOpRnd, oid,
							aid2vc: {}, aid2cc: {}, aidUrl: {},
							curated: {}, voted: {}, votWatch: {},
							clmWatch: {}, vbkAid: {}, opStart, 
							opSync: -1 
						};

						//pull sDB and fIPFS
						this.renewOproundDB(newOpRnd);
						chkClm = true; // remove old claim.
					} else if (newOpRnd === this.game.opround && opDraw !== 0) {
						this.game.drawed = true;
						this.game.lottery = opDraw;
						this.game.winNum = rc[1][5];
						this.game.opStart = opStart;
					}

					if (this.myEpoch < newEpoch) {
						// if we have already synced (newEpoch - 1) block, than advance this.myEpoch 
						if (this.lastBlk === this.myEpoch && newEpoch === this.myEpoch + 1) this.myEpoch = newEpoch;
						this.emit('block', { tick: this.myStamp, epoch: this.myTick, block: newEpoch, chkClm })
					} else {
						if (this.myEpoch > newEpoch) this.myEpoch = newEpoch;

						this.emit('epoch', { tick: this.myStamp, epoch: this.myTick, block: this.myEpoch });
						if (init) this.emit('blockData', {blockNo: this.myEpoch - 1});
					}
				})
			}

			__observe();
        		return setInterval(__observe, sec);
		}

		this.dbsync = () => { 
			if (this.myEpoch - this.lastBlk === 1) {
				if (this.game.opStart === this.myEpoch && this.game.opSync === -1) {
					// opround just started, opSync imposible
					return true;
				} else if (this.game.opStart < this.myEpoch && this.game.opSync === this.lastBlk) {
					return true;
				} else if (this.myEpoch === 1 && this.game.opStart === 0) {
					// genesis special case
					return true;
				} else {
					return false;
				}
		        } else {
				return false;
			}
		}

		this.reports = () =>
                {
                        return {
                                lastStamp: this.myStamp, 
                                optract: { 
                                        epoch: this.myEpoch, 
                                        opround: this.game.opround,
                                        oid: this.game.oid,
                                        opStart: this.game.opStart,
                                        missing: this.lostChunk, 
                                        synced: this.lastBlk,
                                        lottery: {drawed: this.game.drawed, lottery: this.game.lottery, winNumber: this.game.winNum},
					lastMsr: this.game.lastMsr,
					lastSDB: this.game.lastSDB,
					lastFL:  this.game.lastFL
                                },
				ethereum: this.ethNetStatus(),
				account: this.userWallet,
				dbsync: this.dbsync()
			};
                }

		// pubsub handler
		const __lock_file = (lpathdir) =>
                {
                        let lpath = path.join(lpathdir, 'Optract.LOCK');
                        fs.closeSync(fs.openSync(lpath, 'w'))
                }

		__lock_file(path.dirname(this.appCfgs.datadir));

		// JSON for now, leveldb soon
		const Pathwise = require('level-pathwise');
		const level = require('level');
		this.lastBlk = 0;
		this.streamr = {};

		this.parseMsgRLPx = (mRLPx) => { return this.handleRLPx(mfields)(mRLPx); }
		this.showTxContent = (txhash) => { return this.parseMsgRLPx(this.pending.txdata[txhash]); }

		this.getMerkleProof = (leaves, targetLeaf) => {
			let merkleTree = this.makeMerkleTree(leaves);

			let __leafBuffer = Buffer.from(targetLeaf.slice(2), 'hex');
                        let txIdx = merkleTree.tree.leaves.findIndex( (x) => { return Buffer.compare(x, __leafBuffer) == 0 } );
                        if (txIdx == -1) {
                                console.log('Cannot find leave in tree!');
                                return [];
                        } else {
                                console.log(`Found leave in tree! Index: ${txIdx}`);
                        }

                        let proofArr = merkleTree.getProof(txIdx, true);
                        let proof = proofArr[1].map((x) => {return ethUtils.bufferToHex(x);});
                        let isLeft = proofArr[0];

                        let merkleRoot = ethUtils.bufferToHex(merkleTree.getMerkleRoot());
			return [proof, isLeft, merkleRoot];
		}

                this.getBlockData = (sblockNo) => {
                        return this.getBlockInfo(sblockNo).then( (rc) => {
				return { 
					 blockNo: sblockNo, 
					 ethBlockNo: rc[0], 
					 merkleRoot: rc[1], 
					 blockData:  rc[2], 
					 aidData:    rc[4],
					 ipfsHashes: {
						 blk: this.Bytes32toIPFSstring(Buffer.from(rc[2].slice(2), 'hex')),
						 aid: this.Bytes32toIPFSstring(Buffer.from(rc[4].slice(2), 'hex')) 
					 } 
				}
                        })
                }

                this.getPrevBlockData = () => {
                        return this.getBlockNo().then( (sblockNo) =>{
				// sblockNo is *pending* , not yet commited side block no
                                return this.getBlockData(sblockNo-1);
                        })
                }

		this.validateTx = (targetLeaf, sblockNo) =>
		{
			return this.getBlockData(sblockNo).then( (b) => {
				let ipfsHash = Object.values(b.blockData)[0];
				// perhaps we could cache the block results??
				return this.get(ipfsHash).then((d) => {
					let blockJSON = JSON.parse(d.toString());
					let snapshot  = blockJSON.data;
					let leaves    = [ ...snapshot[0] ];
					let mpsets    = this.getMerkleProof(leaves, targetLeaf);
					
					return this.validateMerkleProof(targetLeaf)(...mpsets);
				})
			})
		}

		this.getProofSet = (sblockNo, targetLeaf) =>
		{
			return this.getBlockData(sblockNo).then((b) => {
				let ipfsHash = b.ipfsHashes.blk;
				// perhaps we could cache the block results??
				return this.get(ipfsHash).then((d) => {
					let blockJSON = JSON.parse(d.toString());
					let snapshot  = blockJSON.data;
					let leaves    = [ ...snapshot[0] ];
					return this.getMerkleProof(leaves, targetLeaf);
				})
			})
		}

		this.otimer = observer(150000);

		this.packSnap = (sortTxs = false) =>
		{
			let _tmp = { ...this.pending };
			let _tdt = { ..._tmp.txdata }; 
			let _tpd = { ..._tmp.payload }; 
			let _ths = { ..._tmp.txhash }; 

			let txhs = []; let txdt = []; let txpd = []; 

			Object.keys(_ths).sort().map((acc) => { 
				let a = sortTxs ? _ths[acc].sort() : _ths[acc];
				txhs = [...txhs, ...a];
				a.map((h) => {
					txpd = [ ...txpd, _tpd[h] ];
					txdt = [ ...txdt, _tdt[h] ];
				})
			});

			return [txhs, txpd, txdt];
		}

		// When new opround started, there's actually not much to sync right away, 
		// except for previous opround's sDB and fIPFS ...
		this.renewOproundDB = (newOpRndNo) =>
		{
			if (newOpRndNo >= 2) {
                                return this.getOproundResults(newOpRndNo - 1).then((rc) =>
                                {
                                         this.game.lastMsr = rc[3];  // min success ratee
                                         this.game.lastSDB = rc[4];
                                         this.game.lastFL  = rc[5];
                                }).then(() => 
				{
					this.game.lastSrates = {};
					this.game.lastFinalist = [];

					if ( this.game.drawed  === false
					  && this.game.lastSDB === '0x0000000000000000000000000000000000000000000000000000000000000000' 
					  && this.game.lastFL  === '0x0000000000000000000000000000000000000000000000000000000000000000')
					{
						this.game.lastMsr = 0;
						this.game.lastSDB = '0x0000000000000000000000000000000000000000000000000000000000000000';
						this.game.lastFL = '0x0000000000000000000000000000000000000000000000000000000000000000';

						return;
					}

					let p = [];
					if (this.game.lastSDB !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
						let lastSDB = this.Bytes32toIPFSstring(this.game.lastSDB);
						p.push(this.get(lastSDB).then((rc) => { this.game.lastSrates = JSON.parse(rc.toString()); }));
						p.push(this.ipfs.pin.add(lastSDB));
					}

					if (this.game.lastFL !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
						let lastFL  = this.Bytes32toIPFSstring(this.game.lastFL);
						p.push(this.get(lastFL).then((rc) => { this.game.lastFinalist = JSON.parse(rc.toString()); }))
						p.push(this.ipfs.pin.add(lastFL));
					}

					return Promise.all(p)
					              .catch((err) => { console.log(`DEBUG: in renewOproundDB:`); console.trace(err); })
				})
			} else if (newOpRndNo === 1) {
				// may cause error in next opround if these values are 'underfined'
				this.game.lastMsr = 0;
				this.game.lastSDB = '0x0000000000000000000000000000000000000000000000000000000000000000';
				this.game.lastFL = '0x0000000000000000000000000000000000000000000000000000000000000000';
			}
		}
	}
}

const appCfg = { daemon: true, ...config.node, port: 45054, wsrpc: true };

var opt;
var r;
var title = 'Optract: Ops Console';

if (!appCfg.daemon && appCfg.wsrpc) {
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

	return connectRPC('ws://127.0.0.1:59437')
	 .then((rc) => 
	 {
		if (!rc) throw("failed connection");

		r = repl.start({ prompt: `[-= ${'OptractWsRPC'} =-]$ `, eval: replEvalPromise });
	        r.context = {opt};
	        r.on('exit', () => {
	       	        console.log("\n\t" + 'Stopping WSRPC CLI...');
			opt.close();
		})
	 })
	 .catch((err) => { console.trace(err); })
} else {
	 opt = new OptractNode(appCfg);

	 const handleSignals = () => {
		console.log("\n\t" + 'Stopping WSRPC...');
		opt.leave('Optract');
		opt.swarm.close();

		try {
			fs.unlinkSync(path.join(path.dirname(opt.appCfgs.datadir), 'Optract.LOCK'));
			articleCache['aidlist'] = Object.keys(articleCache.queries);
			if (articleCache['aidlist'].length > 0) fs.writeFileSync(path.join(opt.appCfgs.datadir, 'articleCache.json'), JSON.stringify(articleCache))
		} catch(err) {
			true;
		}

		r.close();
		process.exit(0);
	 }

	 process.on('SIGINT', handleSignals);
	 process.on('SIGTERM', handleSignals);

	 let stage = Promise.resolve(opt)
         .catch((err) => { process.exit(1); })
	 .then(() => {
		r = new WSServer({ port: 59437, host: '127.0.0.1' });

		const expose = 
		{
			vars: ['networkID', 'userWallet', 'pending', 'game'],
			stat: ['reports', 'getPrevBlockData', 'validPass', 'allAccounts', 'getBlockNo', 'dbsync'],
			func: ['getOproundInfo', 'memberStatus', 'getOproundLottery', 'parseMsgRLPx', 'get', 'isValidator'],
			main: [] // obj.args = [arg0, arg1 ...] (ordered args passed as object)
		}

		expose.vars.map((i) => { r.register(i, () => { return opt[i]; }); })
		expose.stat.map((s) => { r.register(s, () => { return opt[s](); }); })
		expose.func.map((f) => { r.register(f, (args) => { let input = args[0]; return opt[f](input); }); })
		expose.main.map((f) => { r.register(f, (obj) => { let inputs = obj.args; return opt[f](...inputs); }); })

		//NOTE: DEBUG only
		r.register('dumpCaches', () => {
			return {articleCache, pickedCache, quoteCache, myQuotes}
		})
	 })
	 .catch((err) => { console.trace(err); })
}
