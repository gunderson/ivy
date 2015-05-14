var Q = require("q");
var fs = require("q-io/fs");
var spawn = require("child-process-promise").spawn;
var yargs = require("yargs");
var Path = require("path");
var status = require("node-status");
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
        name: {
            alias: 'n',
            description: "<name> for output files, defaults to video base name",
            requiresArg: false,
            required: false
        },
        format: {
            alias:'f',
            description: 'format for output',
            default: "png8",
            requiresArg: false,
            required: false
        },
        size: {
            alias:'s',
            description: 'output size (width = 1920/n) [1-6]',
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
var size = +argv.size;
var width = +argv.width;
var height = +argv.height;
var keyframes = +argv.keyframes;
var input = Path.resolve(argv.input);
var outputName = Path.basename(argv.name || input);
var outputLocation = Path.resolve(Path.dirname(input), outputName + "_");

var rawFiles = [];

var tmp = "";

// var statusBars = {
//     directories: status.addItem({
//       name: 'Dirs made',
//       color: 'green',
//       type:["", 'bar', 'percentage'],
//       max:8,
//       count: 4,
//       precision:0
//     })



init()
    .then(makeDirectories)
    .then(chmods)
    .then(makeFrames)
    .then(extractAudio)
    .then(listRawFiles)
    .then(makeDiffFrames)
    .then(treatDiffs)
    .then(makePframes)
    .then(makeFrameTiles)
    .then(optimizeFrames)
    // .then(saveConfig)
    .fail(onError)
    .done(reportComplete);


function init(){

    var deferred = Q.defer();
    deferred.resolve();
    return deferred.promise;
}

// make new folders

function makeDirectories(){
    console.log("Making Directories".green);
    console.log("  ",Path.join(tmp,outputLocation, "raw"));
    console.log("  ",Path.join(tmp,outputLocation, "diff"));
    console.log("  ",Path.join(tmp,outputLocation, "p"));
    console.log("  ",Path.join(tmp,outputLocation, "tiles"));


    var deferred = Q.all([
        fs.makeTree(Path.join(tmp,outputLocation, "raw")),
        fs.makeTree(Path.join(tmp,outputLocation, "diff")),
        fs.makeTree(Path.join(tmp,outputLocation, "p")),
        fs.makeTree(Path.join(tmp,outputLocation, "tiles"))
    ]);

    return deferred.promise;
}

// change permissions of created folders

function chmods(){
    console.log("Changing permissions".green);
    console.log("  ",Path.join(tmp,outputLocation, "raw"));
    console.log("  ",Path.join(tmp,outputLocation, "diff"));
    console.log("  ",Path.join(tmp,outputLocation, "tiles"));
    console.log("  ",Path.join(tmp,outputLocation, "p"));


    var deferred = Q.all([
        fs.chmod(Path.join(tmp,outputLocation, "raw"), "0777"),
        fs.chmod(Path.join(tmp,outputLocation, "diff"), "0777"),
        fs.chmod(Path.join(tmp,outputLocation, "tiles"), "0777"),
        fs.chmod(Path.join(tmp,outputLocation, "p"), "0777")
    ]);

    return deferred.promise;
}

// break video into frames

function makeFrames(){
    console.log("Splitting Video Frames".green);
    var p = spawn("ffmpeg", ["-i", input, Path.join(tmp,outputLocation, "raw", "frame.%4d.png")])
        .progress(function (childProcess) {
            // console.log('[spawn] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                console.log('[spawn ffmpeg] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                //console.log('[spawn ffmpeg] stderr: ', data.toString());
            });
        })
        .fail(function (err) {
            console.error('[spawn ffmpeg] ERROR: '.red, err);
        });
    return p;
}

// extract audio track

function extractAudio(){
    console.log("Extracting Audio Track".green);
    var args = ["-y", "-i", input, "-vn", "-acodec", "mp3", Path.join(tmp,outputLocation,  "audio.mp3")];
    var p = spawn("ffmpeg", args)
        .progress(function (childProcess) {
            childProcess.stdout.on('data', function (data) {
                // console.log('[spawn ffmpeg audio] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                // console.log('[spawn ffmpeg] stderr: ', data.toString());
            });
        })
        .fail(function (err) {
            console.error('[spawn ffmpeg audio] ERROR: '.red, err);
        });
    return p;
}

// List of frames output from ffmpeg

function listRawFiles(){
    return fs.list(Path.join(tmp,outputLocation, "raw")).then(function(fileList){
        frameList = fileList;
    });
}

// Make diff frames

var currentFrame = 1;
var finishedFrames = 0;
var concurrentProcesses = 4;
var frameList = [];
var deferredList = [];
var promiseList = [];

function makeDiffFrames(){
    console.log("Making Diffs".green);

    deferredList = frameList.map(function(){
        return Q.defer();
    });

    //first file will never be completed because there is nothing to compare it to so we should remove it from our list
    deferredList.shift();

    promiseList = deferredList.map(function(def){
        return def.promise;
    });

    //start the number of processes to run
    currentFrame = 1;
    finishedFrames = 0;
    var processes = concurrentProcesses;
    while(processes--){
        makeNextDiff();
    }

    return Q.all(promiseList);
}

function makeNextDiff(){
    //frame array is 0-indexed
    //compare previous image to current image (skip first)
    var filenameA = Path.join(tmp,outputLocation, "raw", frameList[currentFrame - 1]);
    var filenameB = Path.join(tmp,outputLocation, "raw", frameList[currentFrame]);

    //frame files are 1-indexed
    var filenameO = Path.resolve(Path.dirname(filenameA), "../diff", "frame." + (("0000"+(currentFrame+1)).slice(-4)) + ".png");
    var deferred = deferredList[currentFrame-1];
    var _currentFrame = currentFrame;
    

    var p = spawn('compare', [filenameA, filenameB, '-fuzz', "50", '-highlight-color', "#ffffff", '-lowlight-color', "#000000", filenameO])
        .progress(function (childProcess) {
            childProcess.stdout.on('data', function (data) {
            });
            childProcess.stderr.on('data', function (data) {
            });
        })
        .then(function(){
            onDiffComplete(deferred);
        })
        .fail(function (err) {
            // console.error('[spawn compare] ERROR: ', err);
            onDiffComplete(deferred);
        });

    return ++currentFrame;
}

function onDiffComplete(deferred){
    console.log("  -".green, Math.floor(100*++finishedFrames/frameList.length) + "%");
    // console.log(currentFrame, promiseList.length);
    if (currentFrame <= promiseList.length) {
        makeNextDiff();
    }
    deferred.resolve();

}

// process diff images

function treatDiffs(){


    console.log("Treating Diffs".green);
    finishedFrames = 0;
    currentFrame = 0;
    //mogrify -path fullpathto/temp2 -resize 60x60% -quality 60 -format jpg *.png
    //mogrify -blur 0x8 /Users/pg/Development/Tool/experiments/ivy/resources/videos/diff*.png
    var args = ["-verbose", "-blur", "0x16", "-level", "40%,95%,1.6", Path.join(tmp,outputLocation, "diff/","*.png")];

    var p = spawn("mogrify", args)
        .progress(function (childProcess) {
            // console.log('[spawn mogrify] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                // console.log('[spawn mogrify] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                // this event fires twice, once when starting, once when ending
                console.log("  -".green, Math.floor(50 * ++finishedFrames/(frameList.length)) + "%");
                // console.log('[spawn mogrify] stderr: '.red, data.toString());
            });
        })
        .then(function(){
            // console.log("================");
        })
        .fail(function (err) {
            console.error('[spawn treatDiffs()] ERROR: '.red, err, args);
        });
    return p;
}

// combine diff images to raw images

function makePframes(){
    console.log("Making P frames".green);

    deferredList = frameList.map(function(){
        return Q.defer();
    });

    var promiseList = deferredList.map(function(def){
        return def.promise;
    });

    // skip first image
    currentFrame = 0;
    finishedFrames = 0;
    // start the number of processes to run
    var processes = concurrentProcesses;
    while(processes--){
        makeNextPframe();
    }

    return Q.all(promiseList);
}

function makeNextPframe(){
    var filenameA = Path.join(tmp,outputLocation, "raw", frameList[currentFrame]);
    var filenameB = Path.join(tmp,outputLocation, "diff", frameList[currentFrame]);
    var filenameO = Path.resolve(Path.dirname(filenameA), "../p", frameList[currentFrame]);
    var deferred = deferredList[currentFrame];
    var _currentFrame = currentFrame;

    var keyframeDistance = size * size;
    
    if (currentFrame % keyframeDistance === 0){
        // first frames aren't delta frames
        // don't process, just copy
        var cp = fs.copy(filenameA, filenameO).then(function(){
            onPframeComplete(deferred);
        });
        currentFrame++;
        return cp;
    }

    var args = [filenameA, filenameB,  "-alpha", "Off", "-compose", "CopyOpacity", "-composite", filenameO];

    var p = spawn('convert', args)
        .progress(function (childProcess) {
            // console.log('[spawn] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                console.log('[spawn] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                console.log('[spawn] stderr: ', data.toString());
            });
        })
        .then(function () {
            // console.log("  Finished".cyan, filenameO);
            onPframeComplete(deferred);
        })
        .fail(function (err) {
            onPframeComplete(deferred);
            console.error('[spawn] ERROR: '.red, err, _currentFrame, args);
        });


    currentFrame++;
    return;

}

function onPframeComplete(deferred){
    console.log("  -".green, Math.floor(100*++finishedFrames/frameList.length) + "%");

    if (currentFrame < frameList.length) {
        makeNextPframe();
    }
    deferred.resolve();
}

// make tile sets

var frameSets = [];
var frameImages = [];
var currentFrameSet = 0;

function makeFrameTiles(){
    console.log("Making Frame Tiles".green);


    var keyframeDistance = size * size;

    //group frames into sets of 17
    for (var set_i = 0, set_endi = frameList.length/(keyframeDistance); set_i<set_endi; set_i++){
        //group the next 16 into a tile
        var first = set_i * (keyframeDistance);
        frameSets.push(frameList.slice(first, first + keyframeDistance));
    }

    deferredList = frameSets.map(function(){
        return Q.defer();
    });

    var promiseList = deferredList.map(function(def){
        return def.promise;
    });
    finishedFrames = 0;
    //start the number of processes to run
    var processes = concurrentProcesses;
    while(processes--){
        makeNextFrame();
    }

    return Q.all(promiseList);
}

function makeNextFrame(){
    var set = frameSets[currentFrameSet];
    var _currentFrameSet = currentFrameSet;
    var cellWidth = (width/size) >> 0;
    var cellHeight = (height/size) >> 0;
    var deferred = deferredList[currentFrameSet];

    var cp, imageAddress;
    // if (set.length === 1){
    //     //if it's solo, it's a keyframe
    //     imageAddress = Path.join(tmp,outputLocation, "tiles", "frame." + (("0000"+(currentFrameSet+1)).slice(-4)) + ".png");
    //     cp = fs.copy(Path.join(tmp,outputLocation, "p", set[0]), imageAddress);
    // } else {
        set = set.map(function(filename){
            return Path.join(tmp,outputLocation, "p", filename);
        });
        imageAddress = Path.join(tmp,outputLocation, "tiles", "frame." + (("0000"+(currentFrameSet+1)).slice(-4)) + ".png");
        cp = spawn("montage", ["-background", "none", "-geometry", cellWidth+"x"+(cellHeight)+"+0+0", "-tile", size+"x"+size].concat(set).concat([imageAddress]));
    // }

    frameImages.push(imageAddress);
    cp.progress(function (childProcess) {
            childProcess.stdout.on('data', function (data) {
            });
            childProcess.stderr.on('data', function (data) {
            });
        })
        .then(function () {
            makeFrameComplete(deferred);
        })
        .fail(function (err) {
            console.error('[spawn makeNextFrame()] ERROR: '.red, err, args);
            makeFrameComplete(deferred);
        });
    currentFrameSet++;
}

function makeFrameComplete(deferred){
    console.log("  -".green, Math.floor(100*++finishedFrames/frameSets.length) + "%");
    if (currentFrameSet < frameSets.length) {
        makeNextFrame();
    }
    deferred.resolve();
}

function optimizeFrames(){
    console.log("Optimizing Frame Tiles".green);
    return spawn("pngquant", ["-f","--ext", ".png"].concat(frameImages));
}

function saveConfig(){
    var config = {

    };
    //make json
    //write file
}

function onError(err){
    console.log(err);
    console.log("ERROR".red);
}

function reportComplete(){
    console.log("Process Complete".green);
    process.exit();
}

