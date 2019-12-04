'use strict';

const cluster = require('cluster');
const Web3   = require('web3');
const abi  = require('web3-eth-abi');
const keth = require('keythereum');
const net    = require('net');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const uuid  = require('uuid/v4');
const BigNumber = require('bignumber.js');
const fetch     = require('node-fetch');
const ethUtils = require('ethereumjs-utils');
const EthTx = require('ethereumjs-tx').Transaction;
const { promisify } = require('util');

// condition checks
const web3EthFulfill = require( __dirname + '/rpcserv/conditions/Web3/Fulfill.js' );
const web3EthSanity  = require( __dirname + '/rpcserv/conditions/Web3/Sanity.js' );
const TokenSanity    = require( __dirname + '/rpcserv/conditions/Token/Sanity.js' ); // auto mapping from contract ABI
const allConditions  = { ...web3EthSanity, ...web3EthFulfill, ...TokenSanity };

// EIP20 standard ABI
const EIP20ABI = require( __dirname + '/rpcserv/ABI/StandardToken.json' );

// token list (taken from https://balanceof.me)
const Tokens = require( __dirname + '/rpcserv/configs/Tokens.json' );

class KnifeIron {
	constructor(cfgObj) 
	{
		masterpw.set(this, {passwd: null});

		this.web3 = new Web3();
		this.web3.toAddress = address => {
			if (this.web3.isAddress(address)) return address.toLowerCase();

                        let addr = String(this.web3.toHex(this.web3.toBigNumber(address)));

                        if (addr.length === 42) {
                                return addr
                        } else if (addr.length > 42) {
                                throw "Not valid address";
                        }

                        let pz = 42 - addr.length;
                        addr = addr.replace('0x', '0x' + '0'.repeat(pz));

                        return addr;
                };

		this.abi  = abi;
		this.toHex = (input) => { return this.web3.toHex(input) };

		this.CUE = { 'Web3': { 'ETH': {'sendTransaction': this.web3.eth.sendTransaction } }, 'Token': {ABI: {EIP20: EIP20ABI}} };
                Object.keys(allConditions).map( (f) => { if(typeof(this[f]) === 'undefined') this[f] = allConditions[f] } );
		this.groupCons = new Set([]);

		this.setup = (cfgobj) => {
			this.AToken = {};
			this.allocated = {};
			this.configs = cfgobj;
	                this.rpcAddr = this.configs.rpcAddr || null;
			this.networkID = this.configs.networkID || 'NO_CONFIG';
	                this.condition = this.configs.condition || null; // 'sanity' or 'fulfill'
	                this.archfile  = this.configs.passVault || null;

			if (this.archfile !== null) {
	                        this.ds = new FileDatasource(this.archfile);
        	        } else {
                	        this.ds = {};
                	}

			this.GasOracle = this.configs.gasOracleAPI || undefined;
                	this.TokenList = Tokens[this.networkID]; //FIXME!!!
			this.userWallet = {};
                	this.gasPrice = this.configs.defaultGasPrice || 50000000000;
			this.qTimeout  = this.configs.queueInterval || 5000;
		}

		this.switchProvider = (newProvider) =>
		{
			this.web3.setProvider(new Web3.providers.HttpProvider(newProvider));

			if (this.networkID === 'NO_CONNECTION') this.networkID = this.configs.networkID; // reconnected
			try {
				if (typeof(this.web3.version.network) === 'undefined' || this.web3.version.network != this.networkID) {
					console.log(`Connected to network with wrong ID, badRPC: ${newProvider}`);
					this.web3.setProvider(new Web3.providers.HttpProvider(this.rpcAddr));
					return false;
				}

				this.rpcAddr = newProvider;
				return true;
			} catch(err) {
				console.log(`Connected to network with wrong ID, badRPC: ${newProvider}`);
				this.web3.setProvider(new Web3.providers.HttpProvider(this.rpcAddr));
				return false;
			}
		}

		this.connectRPC = () => 
		{
	                const __connectRPC = (resolve, reject) => {
	                        try {
	                                if (
	                                    this.web3 instanceof Web3
	                                 && this.web3.net._requestManager.provider instanceof Web3.providers.HttpProvider
					 && this.web3.net.listening
	                                ) {
	
	                                        if (this.networkID === 'NO_CONNECTION') this.networkID = this.configs.networkID; // reconnected
	                                        if (this.web3.version.network != this.networkID) {
	                                                throw(`Connected to network with wrong ID: wants: ${this.networkID}; geth: ${this.web3.net.version}`);
	                                        }
	
	                                        resolve(true);
	                                } else if (this.web3 instanceof Web3) {
	                                        this.web3.setProvider(new Web3.providers.HttpProvider(this.rpcAddr));
	
	                                        if (this.networkID === 'NO_CONNECTION') this.networkID = this.configs.networkID; // reconnected
	                                        if (this.web3.version.network != this.networkID) {
	                                                throw(`Connected to network with wrong ID: wants: ${this.networkID}; geth: ${this.web3.net.version}`);
	                                        }
	
	                                        resolve(true);
	                                } else {
	                                        reject(false);
	                                }
	                        } catch (err) {
	                                //console.log(err);
	                                reject(false);
	                        }
	                }
	
	                return new Promise(__connectRPC);
	        }

		this.connect = () => {
	                let stage = Promise.resolve();
	
	                stage = stage.then(() => {
	                        return this.connectRPC();
	                })
	                .then((rc) => {
	                        if (rc) {
					this.TokenABI  = this.web3.eth.contract(EIP20ABI);
					return rc;
	                        } else {
	                                throw("no connection");
	                        }
	                })
	                .catch((err) => {
	                        this.networkID = 'NO_CONNECTION';
	                        return Promise.resolve(false);
	                });
	
	                return stage;
	        }
	
		this.ethNetStatus = () =>
	        {
			// stop checking peerCount, mining, and syncing since we are now using Infura 
	                //if (this.web3.net.peerCount === 0 && this.web3.eth.mining === false) {
	                //        return {blockHeight: 0, blockTime: 0, highestBlock: 0};
	                //}
	
	                //let sync = this.web3.eth.syncing;
			let sync = false;
	
	                if (sync === false) {
				let blockInfo = this.web3.eth.getBlock('latest');
	                        let blockHeight = blockInfo.number;
	                        let blockTime;
	
	                        try {
	                                blockTime = blockInfo.timestamp;
	                        } catch(err) {
	                                blockTime = 0;
	                                blockHeight = 0;
	                        }
	
	                        return {blockHeight, blockTime, highestBlock: blockHeight};
	                } else {
	                        let blockHeight = sync.currentBlock;
	                        let highestBlock = sync.highestBlock;
	                        let blockTime;
	                        try {
	                                blockTime = this.web3.eth.getBlock(blockHeight).timestamp;
	                        } catch(err) {
	                                blockTime = 0;
	                                blockHeight = 0;
	                                highestBlock = 0;
	                        }
	
	                        return {blockHeight, blockTime, highestBlock};
	                }
	        }

		this.verifySignedMsg = (msgSHA256Buffer) => (v, r, s, signer) =>
		{
                	let chkhash = ethUtils.hashPersonalMessage(msgSHA256Buffer);
			let originAddress = '0x' +
		              ethUtils.bufferToHex(
                		ethUtils.sha3(
                  			ethUtils.bufferToHex(
                        			ethUtils.ecrecover(chkhash, v, r, s, this.networkID)
                  			)
                		)
              		).slice(26);

        		//console.log(`signer address: ${signer}`);
        		return signer === originAddress;
		}

                this.verifySignature = (sigObj) => //sigObj = {payload, v,r,s, networkID}
                {
                        let signer = '0x' +
                              ethUtils.bufferToHex(
                                ethUtils.sha3(
                                  ethUtils.bufferToHex(
                                        ethUtils.ecrecover(sigObj.payload, sigObj.v, sigObj.r, sigObj.s, sigObj.netID)
                                  )
                                )
                              ).slice(26);

                        console.log(`signer address: ${signer}`);

                        return signer === ethUtils.bufferToHex(sigObj.originAddress);
                }

		this.addrEtherBalance = addr => { return this.web3.eth.getBalance(addr); }
		this.byte32ToAddress = (b) => { return this.web3.toAddress(this.web3.toHex(this.web3.toBigNumber(String(b)))); };
	        this.byte32ToDecimal = (b) => { return this.web3.toDecimal(this.web3.toBigNumber(String(b))); };
        	this.byte32ToBigNumber = (b) => { return this.web3.toBigNumber(String(b)); };

		// These three actually need to be at the client side as well...
		this.toEth = (wei, decimals) => new BigNumber(String(wei)).div(new BigNumber(10 ** decimals));
	        this.toWei = (eth, decimals) => new BigNumber(String(eth)).times(new BigNumber(10 ** decimals)).floor();
        	this.hex2num = (hex) => new BigNumber(String(hex)).toString();

		this.configured = () => 
		{
                	if (this.networkID === 'NO_CONFIG') {
                        	return false;
                	} else {
                        	return true;
                	}
        	}

		this.connected = () => 
		{
	                if (!this.configured()) return false;
	
	                let live;
	                try {
	                        live = this.web3 instanceof Web3 && this.web3.net._requestManager.provider instanceof Web3.providers.HttpProvider && this.web3.net.listening;
	                } catch(err) {
	                        live = false;
	                }
	
	                return live;
	        }

		this.getReceipt = (txHash, interval = 500) =>
	        {
	                if (txHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
	                        return Promise.resolve({status: '0x0', transactionHash: txHash});
	                }
	
	                const transactionReceiptAsync = (resolve, reject) => {
	                        this.web3.eth.getTransactionReceipt(txHash, (error, receipt) => {
	                                if (error) {
	                                        reject(error);
	                                } else if (receipt == null) {
	                                        setTimeout( () => transactionReceiptAsync(resolve, reject), interval);
	                                } else {
	                                        resolve(receipt);
	                                }
	                        });
	                };
	
	                if (Array.isArray(txHash)) {
	                        return Promise.all( txHash.map(oneTxHash => this.getReceipt(oneTxHash, interval)) );
	                } else if (typeof txHash === "string") {
	                        return new Promise(transactionReceiptAsync);
	                } else {
	                        throw new Error("Invalid Type: " + txHash);
	                }
	        }

		this.gasCostEst = (addr, txObj) =>
	        {
	                if (
	                        txObj.hasOwnProperty('gasLimit') == false
	                     || txObj.hasOwnProperty('gasPrice') == false
	                ) { throw new Error("txObj does not contain gas-related information"); }
	
	                let gasBN = this.web3.toBigNumber(txObj.gasLimit);
	                let gasPriceBN = this.web3.toBigNumber(txObj.gasPrice);
	                let gasCost = gasBN.mul(gasPriceBN);
	
	                return gasCost;
	        }

		this.version = '1.0'; // API version

		this.gasPriceEst = () =>
	        {
	                let results = Promise.resolve();
	
	                results = results.then(() =>
	                {
	                        return fetch(this.GasOracle)
	                                .then( (r) => { return r.json(); })
	                                .then( (json) => {
	                                                   return {   // ethGasStation returns unit is 10GWei, hence 10 ** 8
	                                                                low: String(Number(json.safeLow)*(10 ** 8)),
	                                                                mid: String(Number(json.average)*(10 ** 8)),
	                                                               high: String(Number(json.fast)*(10 ** 8)),
	                                                               fast: String(Number(json.fastest)*(10 ** 8)),
	                                                            onblock: json.blockNum
	                                                          };
	                                                 })
	                                .catch( (e) => { throw(e); })
	                })
	
	                return results;
	        }

		this.setAccount = appName => addr =>
	        {
	                this.userWallet[appName] = addr;
	                if (typeof(this.allocated[addr]) === 'undefined') this.allocated[addr] = new BigNumber(0);
	
	                return true;
	        }

		this.verifyApp = appSymbol => (version, contract, abiPath, conditions) =>
	        {
	                if (appSymbol === 'Web3' || appSymbol === 'Token') return false; // preserved words
	
	                // placeholder to call on-chain package meta for verification
	                // This should generate all checksums and verify against the records on pkg manager smart contract
	                // Smart contract ABI binding to pkg manager should happen during constructor call!
	                return true;
	        }

		this.newApp = appSymbol => (version, contract, abiPath, conditions, address = null) =>
	        {
	                if (this.verifyApp(appSymbol)(version, contract, abiPath, conditions) === false) throw 'Invalid dApp info';
	
	                let buffer = fs.readFileSync(abiPath);
	                let artifact = JSON.parse(buffer.toString());
	                artifact.contract_name = contract;
	
	                if (typeof(this.CUE[appSymbol]) === 'undefined') this.CUE[appSymbol] = { ABI: {} };
	
	                if (address === '0x') {
	                        this.CUE[appSymbol][contract] = undefined;
	                        return { [appSymbol]: version, 'Ready': false };
	                }
	
	                // appSymbol contains the string which becomes the 'type' keywords of the app
	                // contract is the name of the contract
	                let abi  = this.web3.eth.contract(artifact.abi);
	                let addr;
	
	                if (address !== null) {
	                        console.debug(`custom address for contract ${contract} found...`);
	                        addr = address;
	                } else {
	                        console.debug(`contract address fixed ...`);
	                        addr = artifact.networks[this.networkID].address;
	                }
	
	                this.CUE[appSymbol][contract] = abi.at(addr);
			this.CUE[appSymbol].ABI[contract] = artifact.abi;

			// console.log(this.CUE[appSymbol].ABI[contract]); console.log('---'); console.log(conditions);	// DEBUG
	                // conditions is objects of {'condition_name1': condPath1, 'condition_name2': condPath2 ...}
	                let allConditions = {};
	
			console.log(`DEBUG: Condition parsing for ${appSymbol}: ${contract}...`);
	                Object.keys(conditions).map((cond) =>
	                {
				console.log(` - ${conditions[cond]}`);
	                        let thiscond = require(conditions[cond]);
	                        allConditions = { ...allConditions, ...thiscond };
	                });

			if (Object.keys(allConditions).length === 0) throw `WARNING: NO condition defined for ${appSymbol}: ${contract}!!!`;
			console.log(allConditions); 
	                // loading conditions. there names needs to follow CastIron conventions to be recognized by queue, otherwise job will fail.
			if (typeof(allConditions.GROUP_CONDITION) !== 'undefined') { // group condition (PoC)
				console.log(`DEBUG: Group Condition found: ${appSymbol}_${allConditions.GROUP_CONDITION}`);
				this.groupCons = new Set([ ...this.groupCons, `${appSymbol}_${allConditions.GROUP_CONDITION}` ]);
				delete allConditions.GROUP_CONDITION;
	                	Object.keys(allConditions).map((f) => { if(typeof(this[f]) === 'undefined') this[f] = allConditions[f] });
			} else {
	                	Object.keys(allConditions).map((f) => { if(typeof(this[`${appSymbol}_${f}`]) === 'undefined') this[`${appSymbol}_${f}`] = allConditions[f] });
			}

			return { [appSymbol]: version, 'Ready': true };
	        }

		this.init = (appName) => (ctrName) => (condType = "Sanity") =>
		{
			let appConfigs = this.configs.dapps[appName]; 

                        const __getABI = (ctrName) =>
                        {
                                return [appConfigs.version, ctrName, path.join(appConfigs.artifactDir, ctrName + '.json')]
                        }

                        const __newAppHelper = (ctrName) => (condType) =>
                        {
                                let output = __getABI(ctrName); let condition = {};
                                let _c = appConfigs.contracts.filter( (c) => { return (c.ctrName === ctrName && c.conditions.indexOf(condType) !== -1) });
                                if (_c.length === 1) {
                                        condition = { [condType]: path.join(appConfigs.conditionDir, appName, ctrName, condType + '.js') };
                                }

                                return [...output, condition];
                        }

			return this.newApp(appName)(...__newAppHelper(ctrName)(condType));

		}

		this.callCache = {};  // key: appName_contract_function_args; val: {result, timestamp}
		this.clearCache = (callID) => 
		{
			if (typeof(this.callCache[callID]) === 'undefined') return true;
			this.callCache[callID]['timestamp'] = 0;
			return true;
		}

		this.call = (appName) => (ctrName) => (callName) => (...args) =>
		{
			let abiObj = null;
			let fromWallet = this.userWallet[appName]; 
			try {
				if (appName === 'Token') {
					fromWallet = this.userWallet[this.appName]; //Note: this.appName should be define in dapp child class 
                			abiObj = this.CUE[appName].ABI['EIP20'].filter((i) => { return (i.name === callName && i.constant === true) } );
				} else {
					if (!fromWallet) throw `${appName} has no default wallet set`;
                			abiObj = this.CUE[appName].ABI[ctrName].filter((i) => { return (i.name === callName && i.constant === true) } );
				}

                		if (abiObj.length === 1 && abiObj[0].inputs.length === args.length) {
                        		let __call = (resolve, reject) => {
						let callTag;

						// for now, only cache simple constant calls with no or single argument.
						if ( args.length === 0) {
							callTag = `${appName}_${ctrName}_${callName}`;
						} else if (args.length === 1) {
							callTag = `${appName}_${ctrName}_${callName}_${args[0]}`;
						}

						if (typeof(callTag) !== 'undefined'
						  && typeof(this.callCache[callTag]) !== 'undefined'
						  && typeof(this.callCache[callTag].result) !== 'undefined'
						  && Math.floor(Date.now()/1000) - this.callCache[callTag].timestamp < 307
						) {
							console.log(`DEBUG: cache used for ${callTag}`)
							return resolve(this.callCache[callTag].result);
						} else if (typeof(callTag) !== 'undefined') {
							this.callCache[callTag] = {timestamp: Math.floor(Date.now()/1000)};
						}

                                		this.CUE[appName][ctrName][callName](...args, {from: fromWallet}, (err, result) => {
                                        		if (err) return reject(err);
                                        		//console.log("HERE!")
							if (typeof(callTag) !== 'undefined'
							) {
								console.log(`DEBUG: cache generated for ${callTag}`)
								this.callCache[callTag]['result'] = result;
							}

                                        		resolve(result);
                                		})
                        		}

                        		return new Promise(__call);
                		} else {
                        		throw "Wrong function or function arguments";
                		}
        		} catch(err) {
                		console.trace(err);
                		return Promise.reject('unsupported constant call');
        		}	
		}

		this.linkAccount = (appName) => (address) =>
		{
			this.userWallet[appName] = address;
			return true;
		} 

		// init
		this.setup(cfgObj);
		this.connect();
	}
}

module.exports = KnifeIron;
