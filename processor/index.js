var Q = require("q");
var fs = require("q-io/fs");
var spawn = require("child-process-promise").spawn;
var yargs = require("yargs");
var Path = require("path");
require("colors");

var pkg = require("./package.json");

var argv = yargs
	.usage('Process video files for Ivy\n\nUsage: $0 [options]')
	.help('help').alias('help', 'h')
	.version(pkg.version, 'version').alias('version', 'V')
	.options({
		input: {
			alias: 'i',
			description: "<filename> Video Input file name",
			requiresArg: true,
			required: true
		},
		output: {
			alias: 'o',
			default: "",
			description: "<foldername> folder for output files, defaults to video base name",
			requiresArg: false,
			required: false
		},
		format: {
			alias:'f',
			description: 'format for output, defaults to png8',
			default: "png8",
			requiresArg: false,
			required: false
		},
		quality: {
			alias:'q',
			description: 'output quality',
			default: "4",
			requiresArg: false,
			required: false
		},
		keyframes: {
			alias:'kf',
			description: 'distance between keyframes',
			default: "16",
			requiresArg: false,
			required: false
		},
		width: {
			alias:'w',
			description: 'output width',
			default: "1920",
			requiresArg: false,
			required: false
		},
		height: {
			alias:'h',
			description: 'output height',
			default: "1080",
			requiresArg: false,
			required: false
		}
	})
	.argv;

var startTime = Date.now;
var quality = +argv.quality;
var width = +argv.width;
var height = +argv.height;
var keyframes = +argv.keyframes;
var input = Path.resolve(argv.input);
var outputName = Path.basename(argv.output) || Path.basename(input);
var outputLocation = Path.resolve(Path.dirname(input),Path.dirname(argv.output) || outputName);

var rawFiles = [];

var tmp = "";

init()
	.then(makeDirectories)
	.then(chmods)
	.then(makeFrames)
	.then(listRawFiles)
	.then(makeDiffFrames)
	.then(makePframes)
	// .then(layoutFrames)
	// .then(saveConfig)
	.fail(onError)
	.done(reportComplete);


function init(){
	var deferred = Q.defer();
	deferred.resolve();
	return deferred.promise;
}

// make new folder
function makeDirectories(){
	console.log("Making Directories".green);
	console.log("  ",Path.join(tmp,outputLocation, "raw"));
	console.log("  ",Path.join(tmp,outputLocation, "diff"));
	console.log("  ",Path.join(tmp,outputLocation, "p"));


	var deferred = Q.all([
		fs.makeDirectory(Path.join(tmp,outputLocation, "raw")),
		fs.makeDirectory(Path.join(tmp,outputLocation, "diff")),
		fs.makeDirectory(Path.join(tmp,outputLocation, "p"))
	]);

	return deferred.promise;
}
function chmods(){
	console.log("Making Directories".green);
	console.log("  ",Path.join(tmp,outputLocation, "raw"));
	console.log("  ",Path.join(tmp,outputLocation, "diff"));
	console.log("  ",Path.join(tmp,outputLocation, "p"));


	var deferred = Q.all([
		fs.chmod(Path.join(tmp,outputLocation, "raw"), "0777"),
		fs.chmod(Path.join(tmp,outputLocation, "diff"), "0777"),
		fs.chmod(Path.join(tmp,outputLocation, "p"), "0777")
	]);

	return deferred.promise;
}

// break video into frames
function makeFrames(){
	console.log("Splitting Video Frames".green);
	return spawn("ffmpeg", ["-i", input, Path.join(tmp,outputLocation, "raw", "frame.%4d.png")]);
}

function listRawFiles(){
	return fs.list(Path.join(tmp,outputLocation, "raw"));
}

var currentFrame = 0;
var concurrentProcesses = 4;
var frameList = [];
var deferredList = [];
var promiseList = [];

function makeDiffFrames(fileList){
	console.log("Making Diffs".green);
	frameList = fileList;

	deferredList = frameList.map(function(){
		return Q.defer();
	});

	promiseList = deferredList.map(function(def){
		return def.promise;
	});

	//start the number of processes to run
	var processes = concurrentProcesses;
	while(processes--){
		makeNextDiff();
	}

	return Q.all(promiseList);
}

function makeNextDiff(){
	var filenameA = Path.join(tmp,outputLocation, "raw", frameList[currentFrame]);
	var filenameB = Path.join(tmp,outputLocation, "raw", frameList[currentFrame + 1]);
	var filenameO = Path.resolve(Path.dirname(filenameA), "../diff", "frame." + (("0000"+(currentFrame+1)).slice(-4)) + ".png");
	var deferred = deferredList[currentFrame];
	
	console.log("  ", filenameO);
	
	var p = spawn('compare', [filenameA, filenameB, "-metric rmse","-fuzz 20", "-highlight-color #ffffff", "-lowlight-color #000000", filenameO])
		.progress(function (childProcess) {
	        console.log('[spawn] childProcess.pid: ', childProcess.pid);
	        childProcess.stdout.on('data', function (data) {
	            console.log('[spawn] stdout: ', data.toString());
	        });
	        childProcess.stderr.on('data', function (data) {
	            console.log('[spawn] stderr: ', data.toString());
	        });
	    })
		.then(function(){
			console.log(filenameO.green);
			onDiffComplete(deferred);
		})
	    .fail(function (err) {
	        console.error('[spawn] ERROR: ', err);
			onDiffComplete(deferred);
	    });


	currentFrame++;
	return;
}

function onDiffComplete(deferred){
	console.log(currentFrame, promiseList.length);
	if (currentFrame < promiseList.length-1) {
		makeNextDiff();
	}
	deferred.resolve();

}

function makePframes(){
	currentFrame = 0;
	console.log("Making P frames".green);
	frameList = fileList;

	deferredList = frameList.map(function(){
		return Q.defer();
	});

	var promiseList = deferredList.map(function(def){
		return def.promise;
	});

	//start the number of processes to run
	var processes = concurrentProcesses;
	while(processes--){
		makeNextPframe();
	}

	return Q.all(promiseList);
}

function makeNextPframe(){
	var filenameA = Path.join(tmp,outputLocation, "raw", frameList[currentFrame]);
	var filenameB = Path.join(tmp,outputLocation, "diff", frameList[currentFrame]);
	var filenameO = Path.resolve(Path.dirname(filenameA), "../p", "frame." + (("0000"+(currentFrame+1)).slice(-4)) + ".png");
	var deferred = deferredList[currentFrame];
	
	console.log("  ", filenameO);
	
	var p = spawn('convert', [filenameA, filenameB, "-alpha Off", "-compose CopyOpacity", "-composite", filenameO])
		.progress(function (childProcess) {
	        console.log('[spawn] childProcess.pid: ', childProcess.pid);
	        childProcess.stdout.on('data', function (data) {
	            console.log('[spawn] stdout: ', data.toString());
	        });
	        childProcess.stderr.on('data', function (data) {
	            console.log('[spawn] stderr: ', data.toString());
	        });
	    })
		.then(function(){
			console.log(filenameO.green);
			onPframeComplete(deferred);
		})
	    .then(function () {
	        console.log('[spawn] done!');
	    })
	    .fail(function (err) {
	        console.error('[spawn] ERROR: ', err);
			onPframeComplete(deferred);
	    });


	currentFrame++;
	return;

}

function onPframeComplete(deferred){

	console.log(currentFrame);
	if (currentFrame < frameList.length - 1) {
		makeNextPframe();
	}
	deferred.resolve();
}

function layoutFrames(){

}

function saveConfig(){

}

function onError(err){
	console.log(err);
	console.log("ERROR".red);
}

function reportComplete(){
	console.log("Process Complete".green);
}

