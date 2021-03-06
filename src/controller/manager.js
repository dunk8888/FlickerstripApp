var extend = require("extend");
var EventEmitter = require("eventemitter2").EventEmitter2;
var _ = require("underscore")._;
var nutil = require("util");
var DiscoveryServer = require("./DiscoveryServer")
var StripWrapper = require("./StripWrapper")
var LEDStrip = require("./LEDStrip")
var fs = require("fs");
var request = require("request");
var https = require("https");
var path = require("path");
var util = require("../shared/util");
var async = require("async");
var pjson = require('../package.json');
var os = require("os");
var getPixels = require("get-pixels")
var yauzl = require("yauzl");
var mkdirp = require("mkdirp");
var progress = require('request-progress');
var Pattern = require('../shared/Pattern.js');

var This = function() {
    this.init.apply(this,arguments);
};

nutil.inherits(This,EventEmitter);
extend(This.prototype,{
    strips:[],
    firmwareRelease:[],
    init:function(folderConfig,send,platform) {
        this.folderConfig = folderConfig;
        this.platform = platform;
        this.serverLocation = pjson.patternRepository;
        this.conduit = util.createConduit(send);

        this.config = {};
        this.loadConfig(_.bind(function() {
            this.discovery = new DiscoveryServer();
            this.discovery.on("DiscoveredClient",_.bind(this.clientDiscovered,this));
        },this));

        this.loadFirmwareReleaseInfo();
        if (platform == "desktop") this.checkForUpdates();

        this.clientData = {};
        this.emit("ClientDataUpdated",this.clientData);

        this.loadPatterns();

        ///////////////////////////////////////// Strip actions
        this.on("SelectPattern",_.bind(function(id,index) {
		    var strip = this.getStrip(id);
            if (!strip) return;
            strip.selectPattern(index);
        },this));
		
        this.on("LoadPattern",_.bind(function(id,pattern,isPreview) {
		    var strip = this.getStrip(id);
            if (!strip) return;
            this.conduit.emit("ShowProgress","Uploading",true);

            var to = null;
            pattern.pixelData = util.fixedTypedArrayDeserialization(pattern.pixelData);
            strip.loadPattern(pattern,isPreview,_.bind(function(err) {
                if (err) console.log("ERR",err);
                this.conduit.emit("HideProgress");
                if (to) clearTimeout(to);
            },this));

            to = setTimeout(_.bind(function() { //20 second timeout
                this.conduit.emit("HideProgress");
            },this),20000);
        },this));

        this.on("UploadFirmware",_.bind(function(id) {
		    var strip = this.getStrip(id);
            if (!strip) return;
            var releaseTag = this.firmwareRelease.latest;
            this.downloadFirmware(releaseTag,_.bind(function() {
                strip.uploadFirmware(path.join(this.folderConfig.firmwareFolder,releaseTag+".bin"));
            },this));
        },this));

        this.on("NextPattern",_.bind(function(id) {
		    var strip = this.getStrip(id);
            if (!strip) return;
            var select = strip.selectedPattern+1;
            if (select >= strip.patterns.length) select = 0;
            strip.selectPattern(select);
        },this));

		this.on("ForgetPattern",_.bind(function(id,index) {
		    var strip = this.getStrip(id);
            if (!strip) return;
			strip.forgetPattern(index);
		},this));

        this.on("SetCycle",_.bind(function(id,seconds) {
            var strip = this.getStrip(id);
            strip.setCycle(seconds);
        },this));

        this.on("SetStripvalue",_.bind(function(id,value) {
            var strip = this.getStrip(id);
            strip.setvalue(value);
        },this));

        this.on("SetStripStart",_.bind(function(id,value) {
            var strip = this.getStrip(id);
            strip.setStart(value);
        },this));

        this.on("SetStripEnd",_.bind(function(id,value) {
            var strip = this.getStrip(id);
            strip.setEnd(value);
        },this));

        this.on("SetStripFade",_.bind(function(id,value) {
            var strip = this.getStrip(id);
            strip.setFade(value);
        },this));

        this.on("SetStripReversed",_.bind(function(id,value) {
            var strip = this.getStrip(id);
            strip.setReversed(value);
        },this));

        this.on("RenameStrip",_.bind(function(id,newname) {
            this.setStripName(id,newname);
        },this));

        this.on("SetGroup",_.bind(function(id,newgroup) {
		    var strip = this.getStrip(id);
            strip.setGroup(newgroup);
        },this));

        this.on("SetBrightness",_.bind(function(id,value) {
            this.setBrightness(id,value);
        },this));

        this.on("ToggleStrip",_.bind(function(id,value) {
		    var strip = this.getStrip(id);
            strip.toggle(value);
        },this));

        this.on("DisconnectStrip",_.bind(function(id) {
            this.disconnectStrip(id);
        },this));

        this.on("ForgetStrip",_.bind(function(id) {
            this.forgetStrip(id);
        },this));
        ///////////////////////////////////////// Strip actions

        this.on("CreateDummy",_.bind(function() {
            strip = new LEDStrip("du:mm:yy:st:ri:ps",null);
            strip.patterns = [{"name":"default"}];
            this.strips.push(strip);
            strip.setVisible(false);
            this.stripAdded(strip);
        },this));

        this.on("SaveImage",_.bind(function(dataUrl,savePath) {
            var data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            var buf = new Buffer(data, 'base64');
            fs.writeFile(savePath, buf,function(err) {
                if (err) console.log("There was an error saving the image!");
            });
        },this));

        this.on("InstallUpdate",_.bind(this.installUpdate,this));

        this.on("OpenImage",_.bind(function(callback,imagePath) {
            getPixels(imagePath,function(err,info) {
                var width = info.shape[0];
                var height = info.shape[1];
                var bpp = info.shape[2];
                info.data = Array.prototype.slice.call(info.data);
                if (bpp == 4) {
                    for (var i=info.data.length-1; i>=0; i--) {
                        if (i % 4 == 3) {
                            info.data.splice(i,1);
                        }
                    }
                }
                callback(width,height,info.data);
            });
        },this));

        this.on("RefreshServerPatterns",_.bind(function(callback) {
            request.get(this.serverLocation+"/pattern?size=200",_.bind(function(error,response,data) {
                var patterns = util.parseJson(data);
                callback(patterns.results);
            },this));
        },this));

        this.on("LoadServerPattern",_.bind(function(callback,id) {
            request.get(this.serverLocation+"/pattern/"+id,_.bind(function(error,response,jsonString) {
                var pattern = new Pattern();
                pattern.deserializeFromJSON(jsonString);
                callback(id,pattern);
            },this));
        },this));

        this.on("GetUser",_.bind(function(callback) {
            callback(this.config.user);
        },this));

        this.on("CreateUser",_.bind(function(callback,email,password,display) {
            var opt = {
                url:this.serverLocation+"/user/create",
                json: {
                    email:email,
                    password:password,
                    display:display,
                }
            };
            request.post(opt,_.bind(function(error,response,user) {
                if (response.statusCode != 200) return callback(false,null);

                callback(true,user);
            },this));
        },this));

        this.on("VerifyUser",_.bind(function(callback,email,password) {
            var opt = {
                url:this.serverLocation+"/user/challenge",
                headers:{
                    "Authorization":"Basic " + new Buffer(email + ":" + password).toString("base64"),
                },
                json:true,
            }
            request.post(opt,_.bind(function(error,response,user) {
                if (response.statusCode != 200) return callback(false,null);

                callback(true,user);
            },this));
        },this));

        this.on("SaveCredentials",_.bind(function(callback,email,password,id) {
            this.config.user = {email:email,password:password,id:id};
            this.saveConfig(callback);
        },this));

        this.on("UploadPattern",_.bind(function(callback,patternData) {
            patternData.pixelData = util.fixedTypedArrayDeserialization(patternData.pixelData);

            var pattern = new Pattern();
            _.extend(pattern,patternData);
            pattern.published = true;

            var opt = {
                url:this.serverLocation+"/pattern/create",
                headers:{
                    "Authorization":"Basic " + new Buffer(this.config.user.email + ":" + this.config.user.password).toString("base64"),
                    "content-type": "application/json"
                },
                body:pattern.serializeToJSON(),
            }
            request.post(opt,_.bind(function(error,response,data) {
                callback(response.statusCode == 200);
            },this));
        },this));

        this.on("DeletePattern",_.bind(function(callback,patternId) {
            var opt = {
                url:this.serverLocation+"/pattern/"+patternId+"/delete",
                headers:{
                    "Authorization":"Basic " + new Buffer(this.config.user.email + ":" + this.config.user.password).toString("base64"),
                },
            }
            request.post(opt,_.bind(function(error,response) {
                callback(response.statusCode == 200);
            },this));
        },this));

        this.on("SavePattern",_.bind(function(patternData) {
            patternData.pixelData = util.fixedTypedArrayDeserialization(patternData.pixelData);

            delete patternData.body;
            delete patternData.index;

            var pattern = new Pattern();
            _.extend(pattern,patternData);

            var name = pattern.name.replace(/[^a-zA-z0-9]/,"");
            var out = pattern.serializeToJSON();

            if (pattern.path) fs.unlinkSync(pattern.path);

            var usePath = this.folderConfig.userPatternFolder ||  this.folderConfig.basicPatternFolder;

            var self = this;
            function createPattern() {
                fs.writeFile(path.join(usePath,name+".pattern"),out,"utf8",_.bind(function(err) {
                    if (err) return console.log("ERROR writing file",err);
                    self.loadPatterns();
                },self));
            }

            fs.exists(usePath,_.bind(function(exists) {
                if (!exists) {
                    fs.mkdir(usePath,_.bind(function(err) {
                        if (err) return console.log("ERROR mkdir! ",err,usePath);
                        createPattern();
                    },this));
                } else {
                    createPattern();
                }
            },this));
        },this));
    },
    populatePattern:function(content) {
        if (content.startsWith("{")) {
            //load json format
            var pattern = new Pattern();
            pattern.deserializeFromJSON(content);
            return pattern;
        } else {
            //legacy load code
            var loc = content.indexOf("\n\n");
            var headerraw = content.substring(0,loc);
            var body = content.substring(loc+2);

            var pattern = new Pattern();
            _.each(headerraw.split("\n"),function(line) {
                if (line == "") return;
                var index = line.indexOf(":");
                var tokens = [line.substring(0,index),line.substring(index+1)];
                if (tokens[1][0] == "[" || tokens[1][0] == "{") {
                    //assume json
                    tokens[1] = util.parseJson(tokens[1]);
                }
                pattern[tokens[0]] = tokens[1];
            });

            pattern.body = body[0] == "[" || body[0] == "{" ? util.parseJson(body) : body;
            if (pattern.type == "bitmap") {
                pattern.pixelData = pattern.body;
            } else {
                pattern.code = pattern.body;
                pattern.renderJavascriptPattern();
            }
            delete pattern.type;
            return pattern;
        }
    },
    loadPatterns:function() {
        this.loadFolderPatterns(this.folderConfig.userPatternFolder,_.bind(function(patterns) {
            this.userPatterns = patterns;
            this.conduit.emit("PatternsLoaded",this.userPatterns);
        },this));
        if (this.folderConfig.basicPatternFolder) { //only happens in mobile.. atm
            this.loadFolderPatterns(this.folderConfig.basicPatternFolder,_.bind(function(patterns) {
                this.basicPatterns = patterns;
                this.conduit.emit("BasicPatternsLoaded",this.basicPatterns);
            },this));
        }

        if (platform == "desktop") {
            this.loadPatternFile(path.join(this.folderConfig.userPatternFolder,"_defaultAdvanced.pattern"),_.bind(function(err,pattern) {
                this.clientData.defaultAdvanced = pattern;
                this.conduit.emit("ClientDataUpdated",this.clientData);
            },this));
        }
    },
    loadFolderPatterns(fpath,cb) {
        fs.readdir(fpath,_.bind(function(err,files) {
            if (err) {
                return console.log("ERROR READING DIR",path,err);
                cb(null);
            }
            files = _.reject(files,function(name) { return name.startsWith("_") || name.startsWith("."); });
            async.map(files,_.bind(function(file,callback) {
                this.loadPatternFile(path.join(fpath,file),callback);
            },this),_.bind(function(err,patterns) {
                cb(patterns);
            },this));
        },this));
    },
    loadPatternFile(filePath,callback) {
        fs.readFile(filePath,'utf8',_.bind(function(err,contents) {
            if (err) return callback(err,null);
            var filename = path.basename(filePath);
            var pattern = this.populatePattern(contents);

            pattern.path = filePath;
            callback(err,pattern);
        },this));
    },
    installUpdate:function(version) {
        var downloadName = null;
        if (process.platform == "darwin")  {
            downloadName = "FlickerstripApp-OSX64-"+version+".zip";
        } else if (process.platform == "win32") {
            downloadName = "FlickerstripApp-Win64-"+version+".zip";
        } else if (process.platform == "linux") {
            downloadName = "FlickerstripApp-Linux64-"+version+".zip";
        }

        var unpackDirectory = path.join(os.tmpdir(),util.generateGuid());
        fs.mkdirSync(unpackDirectory);
        //var unpackDirectory = 'C:\\Users\\Julian\\AppData\\Local\\Temp\\71024787-c519-9a6b-d233-6e65473a954b';

        var zipPath = path.join(unpackDirectory,downloadName);
        var f = fs.createWriteStream(zipPath);

        function updateFiles() {
            this.conduit.emit("HideProgress");
            var folderPath = path.join(unpackDirectory,path.parse(zipPath).name);
            this.conduit.emit("Update",folderPath);
        }

        function unpackZip() {
            this.conduit.emit("ShowProgress","Unpacking...",false);
            yauzl.open(zipPath, {lazyEntries: true},_.bind(function(err, zipfile) {
                if (err) throw err;
                zipfile.readEntry();
                var entriesTotal = zipfile.entryCount;
                var entriesRead = 0;
                zipfile.on("entry",_.bind(function(entry) {
                    entriesRead++;
                    this.conduit.emit("UpdateProgress",Math.floor(100*entriesRead/entriesTotal));
                    if (/\/$/.test(entry.fileName)) {
                        // directory file names end with '/' 
                        mkdirp(path.join(unpackDirectory,entry.fileName), function(err) {
                            if (err) throw err;
                            zipfile.readEntry();
                        });
                    } else {
                        // file entry 
                        zipfile.openReadStream(entry, function(err, readStream) {
                            if (err) throw err;
                            // ensure parent directory exists 
                            mkdirp(path.join(unpackDirectory,path.dirname(entry.fileName)), function(err) {
                                if (err) throw err;
                                readStream.pipe(fs.createWriteStream(path.join(unpackDirectory,entry.fileName)));
                                readStream.on("end", function() {
                                    zipfile.readEntry();
                                });
                            });
                        });
                    }
                },this));
                zipfile.once("end",_.bind(updateFiles,this));
            },this));
        }
		
        this.conduit.emit("ShowProgress","Downloading Version <strong>"+version+"</strong>",false);
        progress(request("https://github.com/Flickerstrip/FlickerstripApp/releases/download/"+version+"/"+downloadName,_.bind(function() {
			setTimeout(_.bind(unpackZip,this),300);
        },this)))
        .on("progress",_.bind(function(state) {
            this.conduit.emit("UpdateProgress",state.percent);
        },this))
        .pipe(f);
        //https://github.com/Flickerstrip/FlickerstripApp/releases/download/v0.3.1/FlickerstripApp-Linux64-v0.3.1.zip
    },
    checkForUpdates:function() {
        if (this.config.lastUpdateCheck && new Date().getTime() - this.config.lastUpdateCheck < 1000*60*60*24) {
            console.log("Skipping update check");
            return;
        }

        request({
            url:"https://api.github.com/repos/Flickerstrip/FlickerstripApp/releases",
            json:true,
            headers: {
                "User-Agent":"Flickerstrip-Dashboard",
            }
        },_.bind(function(error,response,releases) {
            if (error) {
                console.log("Failed to load flickerstrip app release information: ",error.code);
                return;
            }
            releases.sort(function(b,a) {
                return util.symanticToNumeric(a["tag_name"]) - util.symanticToNumeric(b["tag_name"]);
            });
            this.appReleases = releases;
            var latest = releases[0];
            var tagName = latest["tag_name"];
            if (util.symanticToNumeric(tagName) > util.symanticToNumeric(pjson.version)) {
                this.conduit.emit("UpdateAvailable",tagName);
            } else {
                this.config.lastUpdateCheck = new Date().getTime();
                this.saveConfig();
            }
        },this));
        
    },
    loadFirmwareReleaseInfo:function() {
        request({
            url:"http://flickerstrip.com/firmware/latest.json",
            json:true,
            headers: {
                "User-Agent":"Flickerstrip-Dashboard",
            }
        },_.bind(function(error,response,releaseInfo) {
            if (error) {
                console.log("Failed to load firmware release information: ",error.code);
                return;
            }
            this.firmwareRelease = releaseInfo;
            var latest = this.firmwareRelease.latest;
            this.conduit.emit("LatestReleaseUpdated",latest);
            this.downloadFirmware(latest,function(downloaded) {
                if (downloaded) {
                    console.log("downloaded firmware: ",latest);
                } else {
                    console.log("already downloaded firmware: ",latest);
                }
            });
        },this));
    },
    downloadFirmware:function(release,cb) {
         if (!fs.existsSync(this.folderConfig.firmwareFolder)){
            fs.mkdirSync(this.folderConfig.firmwareFolder);
        }
        var binPath = path.join(this.folderConfig.firmwareFolder,release+".bin");
        if (fs.existsSync(binPath)) {
            if (cb) cb(false);
            return;
        }
        var f = fs.createWriteStream(binPath);
        request("http://flickerstrip.com/firmware/"+release+".bin")
            .on("response",function() {
                    if (cb) cb(true);
            }).pipe(f);
        //download url: https://github.com/Flickerstrip/FlickerstripFirmware/releases/download/v0.0.1/v0.0.1.bin
    },
    eventHandler:function(emitObject) {
        if (emitObject.target) {
        } else if (emitObject.callback) {
            var conduit = this.conduit;
            var cb = function() {
                conduit.respond(emitObject.callback,arguments);
            };
            this.emit.apply(this,[emitObject.name,cb].concat(emitObject.args).concat([emitObject]));
        } else {
            this.emit.apply(this,[emitObject.name].concat(emitObject.args).concat([emitObject]));
        }
    },
    loadConfig:function(cb) {
        if (!fs.existsSync(this.folderConfig.configLocation)) {
            if (cb) cb();
            return;
        }
        fs.readFile(this.folderConfig.configLocation, "ascii", _.bind(function(err,contents) {
            if (err) return console.log("Failed to load strip data:",err);
            try {
                var config = util.parseJson(contents);
                this.config = config;

                //load strips
                this.strips = [];
                if (!this.config || !this.config.strips) {
                    this.config = {};
                    if (cb) cb();
                    return;
                }
                _.each(this.config.strips,_.bind(function(strip) {
                    var lstrip = new LEDStrip();
                    for (var key in strip) {
                        if (key.indexOf("_") === 0) continue;
                        if (strip.hasOwnProperty(key)) {
                            lstrip[key] = strip[key];
                        }
                    }
                    this.strips.push(lstrip);
                    lstrip.visible = false;
                    this.stripAdded(lstrip);
                },this));
            } catch (e) {
                console.log("error loading config file",e);
            }
            if (cb) cb();
        },this));
    },
    stripAdded:function(strip) {
        var self = this;
        strip.onAny(function() {
            self.conduit.emitOn.apply(self,[this.event,"strip",strip].concat(Array.prototype.slice.call(arguments)));
        });

        strip.on("Strip.StatusUpdated",_.bind(this.saveConfig,this));
        strip.on("NameUpdated",_.bind(this.saveConfig,this));

        this.conduit.emit("StripAdded",strip);
    },
    saveConfig:function(cb) {
        this.config.strips = this.strips;
        var text = JSON.stringify(this.config,function(key,value) {
            if (key.indexOf("_") === 0) {
                return undefined;
            }
            return value;
        });
        fs.writeFile(this.folderConfig.configLocation,text,function(err) {
            if (err) console.err("Failed to write strip data",err);
            if (cb && typeof(cb) == "function") cb();
        });
    },
   /////////////////////
    setStripName:function(id,name) {
        var strip = this.getStrip(id);
        strip.setName(name);
    },
    setBrightness:function(id,value) {
        var strip = this.getStrip(id);
        strip.setBrightness(value);
    },
    forgetStrip:function(id) {
        var index = this.getStripIndex(id);
        this.strips.splice(index,1);
        this.saveConfig()
        this.conduit.emit("StripRemoved",id);
    },
    disconnectStrip:function(id) {
        var strip = this.getStrip(id);
        strip.disconnectStrip();
    },
///////////////////////////////////////////////////////////////////////////////
    getStrips:function() {
        return this.strips;
    },
    getStripIndex:function(id) {
        var found = null;
        _.each(this.strips,function(strip,index) {
            if (found != null) return;
            if (strip.id == id) found = index;
        });
        return found;
    },
    getStrip:function(id) {
        var index = this.getStripIndex(id);
        if (index != null) return this.strips[index];
        return null;
    },
    clientDiscovered:function(ip) {
        var found = null;
        _.each(this.strips,function(strip,index) {
            if (strip.ip == ip) found = strip;
        });
        if (found != null) {
            found.setVisible(true);
            return;
        }

        request("http://"+ip+"/status",_.bind(function(error, response, body) {
            if (error) return console.log("Failed to connect to "+ip);
            var status = util.parseJson(body);
            this.clientIdentified(ip,status);
        },this));
    },
	clientIdentified:function(ip,status) {
        console.log("Client identified: ",status.mac,ip);
        var strip = this.getStrip(status.mac);
        if (!strip) {
            strip = new LEDStrip(status.mac,ip);
            this.strips.push(strip);
            strip.receivedStatus(status);
            strip.setVisible(true);
            this.saveConfig();
            this.stripAdded(strip);
        } else {
            strip.ip = ip;
            strip.receivedStatus(status);
            strip.setVisible(true);
        }
	}
});

module.exports = This;
