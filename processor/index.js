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
var outputLocation = Path.resolve(Path.dirname(input), outputName + "_");

var rawFiles = [];

var tmp = "";

init()
    .then(makeDirectories)
    // .then(chmods)
    // .then(makeFrames)
    .then(listRawFiles)
    // .then(makeDiffFrames)
    // .then(treatDiffs)
    // .then(makePframes)
    .then(makeFrameTiles)
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
    console.log("  ",Path.join(tmp,outputLocation, "output"));


    var deferred = Q.all([
        fs.makeTree(Path.join(tmp,outputLocation, "raw")),
        fs.makeTree(Path.join(tmp,outputLocation, "diff")),
        fs.makeTree(Path.join(tmp,outputLocation, "p")),
        fs.makeTree(Path.join(tmp,outputLocation, "output"))
    ]);

    return deferred.promise;
}
function chmods(){
    console.log("Changing permissions".green);
    console.log("  ",Path.join(tmp,outputLocation, "raw"));
    console.log("  ",Path.join(tmp,outputLocation, "diff"));
    console.log("  ",Path.join(tmp,outputLocation, "output"));
    console.log("  ",Path.join(tmp,outputLocation, "p"));


    var deferred = Q.all([
        fs.chmod(Path.join(tmp,outputLocation, "raw"), "0777"),
        fs.chmod(Path.join(tmp,outputLocation, "diff"), "0777"),
        fs.chmod(Path.join(tmp,outputLocation, "output"), "0777"),
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
            console.error('[spawn ffmpeg] ERROR: ', err);
        });
    return p;
}

function listRawFiles(){
    return fs.list(Path.join(tmp,outputLocation, "raw")).then(function(fileList){
        frameList = fileList;
    });
}

var currentFrame = 1;
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
    
    console.log("  Starting".green, filenameO);

    var p = spawn('compare', [filenameA, filenameB, '-fuzz', "50", '-highlight-color', "#ffffff", '-lowlight-color', "#000000", filenameO])
        .progress(function (childProcess) {
            // console.log('[spawn compare] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                //console.log('[spawn compare] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                //console.log('[spawn compare] stderr: '.red, data.toString());
            });
        })
        .then(function(){
            console.log("================");
            onDiffComplete(deferred);
        })
        .fail(function (err) {
            //console.error('[spawn compare] ERROR: ', err);
            onDiffComplete(deferred);
        });

    return ++currentFrame;
}

function onDiffComplete(deferred){
    // console.log(currentFrame, promiseList.length);
    if (currentFrame <= promiseList.length) {
        makeNextDiff();
    }
    deferred.resolve();

}

function treatDiffs(){


    console.log("Treating Diffs".green);

    //mogrify -path fullpathto/temp2 -resize 60x60% -quality 60 -format jpg *.png
    //mogrify -blur 0x8 /Users/pg/Development/Tool/experiments/ivy/resources/videos/diff*.png
    var args = ["-verbose", "-blur", "0x16", "-level", "40%,95%,1.6", Path.join(tmp,outputLocation, "diff/","*.png")];

    var p = spawn("mogrify", args)
        .progress(function (childProcess) {
            console.log('[spawn mogrify] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                console.log('[spawn mogrify] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                console.log('[spawn mogrify] stderr: '.red, data.toString());
            });
        })
        .then(function(){
            console.log("================");
        })
        .fail(function (err) {
            console.error('[spawn mogrify] ERROR: ', err, args);
        });
    return p;
}

function makePframes(){
    console.log("Making P frames".green);

    deferredList = frameList.map(function(){
        return Q.defer();
    });

    var promiseList = deferredList.map(function(def){
        return def.promise;
    });

    // copy first image to /p since it doesn't need to be processed
    var cp = fs.copy(Path.join(tmp,outputLocation, "raw", frameList[0]), Path.join(tmp,outputLocation, "p", frameList[0]));
    promiseList[0] = cp;

    // skip first image
    currentFrame = 1;
    
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
    
    console.log("  Starting".green, filenameO);
    
//  convert ../resources/videos/raw/frame.0002.png ../resources/videos/diff/frame.0002.png -alpha Off -compose CopyOpacity -composite ../resources/videos/p/frame.0002.png

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
    if (currentFrame <= frameList.length) {
        makeNextPframe();
    }
    deferred.resolve();
}

var frameSets = [];
var currentFrameSet = 0;

function makeFrameTiles(){
    console.log("Making Frame Tiles".green);


    var keyframeDistance = 16;

    //group frames into sets of 17
    for (var set_i = 0, set_endi = frameList.length; set_i<set_endi; set_i++){
        //for each set, make the keyframe a solo frame
        var first = set_i * (1+keyframeDistance);
        frameSets.push([frameList[first]]);
        //group the next 16 into a keyframe
        frameSets.push(frameList.slice(first + 1, first + 1 + keyframeDistance));
    }

    deferredList = frameSets.map(function(){
        return Q.defer();
    });

    var promiseList = deferredList.map(function(def){
        return def.promise;
    });

    //start the number of processes to run
    // skip first image
    var processes = concurrentProcesses;
    while(processes--){
        makeNextFrame();
    }

    return Q.all(promiseList);
}

function makeNextFrame(){
    var set = frameSets[currentFrameSet];
    var _currentFrameSet = currentFrameSet;
    var cp;
    var cellWidth = (width/quality) >> 0;
    var cellHeight = (height/quality) >> 0;
    var deferred = deferredList[currentFrameSet];

    if (set.length === 1){
        cp = fs.copy(Path.join(tmp,outputLocation, "p", set[0]), Path.join(tmp,outputLocation, "output", "frame." + (("0000"+(currentFrameSet+1)).slice(-4)) + ".png"));
    } else {
        set = set.map(function(filename){
            return Path.join(tmp,outputLocation, "p", filename);
        });
        cp = spawn("montage", ["-geometry", cellWidth+"x"+(cellHeight)+"+0+0", "-tile", quality+"x"+quality].concat(set).concat(Path.join(tmp,outputLocation, "output", "frame." + (("0000"+(currentFrameSet+1)).slice(-4)) + ".png")));
    }

    console.log("  making".green, _currentFrameSet);
    cp.progress(function (childProcess) {
            // console.log('[spawn] childProcess.pid: ', childProcess.pid);
            childProcess.stdout.on('data', function (data) {
                console.log('[spawn] stdout: ', data.toString());
            });
            childProcess.stderr.on('data', function (data) {
                console.log('[spawn] stderr: ', data.toString());
            });
        })
        .then(function () {
            console.log("  Finished".cyan, _currentFrameSet);
            makeFrameComplete(deferred);
        })
        .fail(function (err) {
            console.error('[spawn] ERROR: ', err, args);
            makeFrameComplete(deferred);
        });
    currentFrameSet++;
}

function makeFrameComplete(deferred){
    if (currentFrameSet <= frameSets.length) {
        makeNextFrame();
    }
    deferred.resolve();
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

