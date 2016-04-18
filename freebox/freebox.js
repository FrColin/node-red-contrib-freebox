/**
 * Freebox API
 *
 
 */

module.exports = function (RED) {

	'use strict';
	var crypto = require('crypto');
	var rest = require('rest');
	var mime = require('rest/interceptor/mime');
	var errorCode = require('rest/interceptor/errorCode');
	var pathPrefix = require('rest/interceptor/pathPrefix');
	var timeout = require('rest/interceptor/timeout');
	var when = require('when');
	var util = require('util');

	function FreeboxNode(config) {
		RED.nodes.createNode(this, config);
		var node = this;

		// Retrieve the config node
		this.server = config.server;
		this.serverConn = RED.nodes.getNode(this.server);
		if (!this.serverConn) {
			RED.log.info('server Not configured');
			RED.log.debug('server Not configured ' + config);
            node.status({ fill: "red", shape: "ring", text: 'bad reply' });
						
		} else {
            node.status({ fill: "green", shape: "dot", text: "connected" });
        }

        this.on('input', function (msg) {
			//RED.log.debug('call freebox API '+msg.payload);
            if (node.serverConn) 
                    node.serverConn.callApi(node,msg);
        });
		this.on('close', function () {
			// tidy up any async code here - shutdown connections and so on.
		});
    }

	RED.nodes.registerType('freebox', FreeboxNode);

	function FreeboxServerNode(n) {
        RED.nodes.createNode(this, n);
        var node = this;
		//Freebox informations
		node.freebox = {
			ip: 'mafreebox.freebox.fr', //default
			port: 80, //default

			url: '',

			uid: '', //freebox id
			deviceName: '',
			deviceType: '',

		};

		//
		node.app = {
			app_id: "node-red-contrib-freebox",
			app_name: "node-red Freebox API",
			app_version: '0.0.1',
			device_name: "MBA",

			app_token: '',
			track_id: '',

			status: '',
			logged_in: false,

			challenge: '',
			password: '',
			session_token: '',

			permissions: {}
		};
		node.prefix = { prefix: 'http://mafreebox.free.fr' };
		this.client = rest.wrap(mime, { mime: 'application/json' })
			.wrap(errorCode)
			.wrap(timeout,{ timeout: 10e3 })
			.wrap(pathPrefix, node.prefix);


		this._freebox_api_request = function (url, data) {
			//RED.log.info ("_freebox_api_request url:"+url );
		
			var app = this.app;

			var options = {
				path: url,
				method: data ? 'POST' : 'GET',
				entity: data,
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					'X-Fbx-App-Auth': app.session_token
				},
				encode: 'utf-8'
			};

			return this.client(options).then(
				function (response) {

					//RED.log.info(" _freebox_api_request Reply " + util.inspect(response.entity));

					if ('success' in response.entity ) {
						
					 	if ( response.entity.success ) return response.entity.result;
						 else return response.entity;
					}
					RED.log.error(" Freebox " + url + " Failed : " + JSON.stringify(response.entity));
					return response.entity;

				},
				function (response) {
					RED.log.error(' FreeboxApiReq '+response.request.path+' response error: '+ JSON.stringify(response.entity));
					app.logged_in = false; //Update login status
					return response.entity;
				}
				);
		};
		
		/**
		 * connect method
		 *
		 * Example :
		 *
		 * freebox.connect();
		 * 
		 * Update freebox information
		 * 
		 * @return void
		 */
		this.connect = function (config) {

			var freebox = this.freebox;
			var app = this.app;
			var node = this;
			// Retrieve the config node
			this.server = RED.nodes.getNode(config.server);
			this.ip = config.host;
			this.port = config.port;
			freebox.ip = config.host;
			freebox.port = config.port;
			//RED.log.info("This.Cred " + JSON.stringify(this.credentials));
			app.app_token = this.credentials.app_token;
			app.track_id = this.credentials.track_id;
			
			node.prefix.prefix = 'http://' + freebox.ip + ':' + freebox.port;
			
			RED.log.info('FreeboxNode connect ' + node.prefix.prefix + '/api_version');

			return this.client({ method: 'GET', path: '/api_version' }).then(
				function (response) {

					if ('uid' in response.entity) {
						freebox.uid = response.uid;
						freebox.deviceName = response.entity.device_name;
						freebox.deviceType = response.entity.device_type;
	
						var apiCode = 'v' + response.entity.api_version.substr(0, 1);
						var apiBaseUrl = response.entity.api_base_url;
	
						freebox.url = node.prefix.prefix + apiBaseUrl + apiCode + '/';
						node.prefix.prefix = freebox.url;
						RED.log.info('FreeboxNode url ' + freebox.url);
	
						node.status({ fill: "green", shape: "dot", text: "connected" });
						if (!node.app.app_token) {
							return node.loginApp();
						} else {
							return node.sessionApp();
						}
					} else {
						RED.log.error(' Freebox '+response.request.path+' response bad format error: '+ JSON.stringify(response.entity));
						node.status({ fill: "red", shape: "ring", text: 'bad reply' });
						return response.entity;
					}
				},
				function (response) {
					RED.log.error(' Freebox '+response.request.path+' response error: '+ response.entity);
					node.status({ fill: "red", shape: "ring", text: response.entity });
					return response.entity;
				}
				);
		};

		/**
		 * registerApp method
		 *
		 * Example :
		 *
		 * freebox.register();
		 *
		 * Register the app to the Freebox
		 * A message will be displayed on the Freebox LCD asking the user to grant/deny access to the requesting app.
		 * 
		 * @return void
		 */
		this.registerAppTrack = function () {

			//Asking for an app token
			var app = this.app;
			var node = this;
	

			//Track authorization progress
	
			return node._freebox_api_request('login/authorize/' + app.track_id).then(
				function (response) {

					app.status = response.status; //Normaly 'pending'
					app.challenge = response.challenge;

					node.credentials.app_token = app.app_token;
					node.credentials.track_id = app.track_id;
					RED.nodes.addCredentials(node.id, node.credentials);
					
					//The user must accept the app on the box
					switch (app.status) {
						case 'pending':
							RED.log.error("The app is not accepted. You must register it.", 'info');
							return node.registerAppTrack();
							
						case 'granted':
							return node.sessionApp();
							
						default:
							RED.log.error("Register  app failed.", 'info');
                            return 0;
							
					}

				}
				);


		};
		this.registerApp = function () {

			//Asking for an app token
			var app = this.app;
			var node = this;
			
			var data = {
				"app_id": app.app_id,
				"app_name": app.app_name,
				"app_version": app.app_version,
				"device_name": app.device_name
			};
			return node._freebox_api_request('login/authorize', data).then(

				function (response) {

					app.app_token = response.app_token;
					app.track_id = response.track_id;
					RED.log.info("Register  app token " + app.app_token);
					//Track authorization progress
			
					return node.registerAppTrack();
				});

		};

		/**
		 * loginApp method
		 *
		 * Play before each call to the box
		 * 
		 * @return {[type]}        [description]
		 */
		this.loginApp = function () {

			var app = this.app;
			var node = this;
			RED.log.error('loginAPP is ' + app.status);
			if (app.status == 'granted') //If we know the app accepted by the box (user action)
			{
				//Update challenge and log the app if needed
				return node.sessionApp();
			}
			else {
				if (app.track_id) {
					//We check if the user has accepted the app
					return node.registerAppTrack();
				} else {
					return node.registerApp();
				}
			}
		}

		/**
		 * sessionApp method
		 *
		 * Update login status and challenge.
		 * If needed log the app = Ask for a session token.
		 * 
		 * @return void
		 */
		this.sessionApp = function () {

			var freebox = this.freebox;
			var app = this.app;
			var node = this;
	
			//Asking a new challenge
			RED.log.info("Login " + freebox.url + 'login');
			return node._freebox_api_request('login', null).then(
				function (result) {

					app.logged_in = result.logged_in; //Update login status
					app.challenge = result.challenge; //Update challenge

					//Update password
					app.password = crypto.createHmac('sha1', app.app_token).update(app.challenge).digest('hex'); 


					//If we're not logged_in
			
					if (!app.logged_in) {
						//POST app_id & password
						var data = {
							"app_id": app.app_id,
							"app_version": app.app_version,
							"password": app.password,
						};
						return node._freebox_api_request('login/session/', data).then(
							function (response) {

								app.challenge = response.challenge; //Update challenge

								app.session_token = response.session_token; //Save session token
								app.logged_in = true; //Update login status
								app.permissions = response.permissions;
								//
								node.status({ fill: "green", shape: "dot", text: "session open" });
								RED.log.info('Session Opened perm ' + JSON.stringify(app.permissions));
							});
					}


				});
		}
		/**
		 * sessionClose method
		 *
		 * logout.
		 * 
		 * @return void
		 */
		this.sessionClose = function () {

			var app = this.app;
			var node = this;
	
			//Asking a new challenge
			return node._freebox_api_request('login/logout', {}).then(
				function (response) {
					app.logged_in = false; //Update login status
						
					node.status({ fill: "green", shape: "dot", text: "session open" });
					RED.log.info('Session Close');
				});
		}
		this.callApi = function (dst,msg) {
			var node = this;

			if (this.freebox) {

				var url = msg.payload;
				var data = msg.data;
                node.connected.then(function(connect){ 
                    return node._freebox_api_request(url, data).then(
                        function (response) {
                            //var outputMsgs = [];
                            //response.forEach(function(entry) {
                            //    outputMsgs.push({payload:entry});
                            //});
                            //dst.send( [ outputMsgs ]); //return result
                            msg.payload = response;
                            dst.send( msg ); //return result
                        });
                });
			} else {
				RED.log.info('callApi server Not configured');
			}
		}
		this.on('close', function () {
            node.sessionClose();
        });
		this.connected = this.connect(n);
       
    }
    RED.nodes.registerType("freebox-server", FreeboxServerNode, {
        credentials: {
            app_token: { type: "password" },
            track_id: { type: "password" }
        }
    });
}
