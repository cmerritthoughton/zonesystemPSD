// ExtendScript helper for tools/make-walkthrough.sh. arguments[0] is the step:
//   open <image> <title>     close leftovers, then open a working copy titled <title>
//   results                  the JSON caption of VF_WALK_RESULTS
//   export <dir>             save every VF_FIG_* document as <dir>/<name>.jpg
//   cleanup <title>          close every document the generator created
//   remaining <title>        names of generator documents still open, one per line
//   classify <title> <name>… "name=true|false" for each name (used by the tests)
var step = arguments[0];

// Names are compared as plain strings. Photoshop's ExtendScript regex engine
// mishandles alternation such as /^VF_WALK|^VF_FIG_|^(Opportunities — )?T$/:
// it matched only the last branch, which once left every figure open.
var SHEET_PREFIX = "Opportunities — ";

function startsWith(name, prefix) {
  return name.substring(0, prefix.length) === prefix;
}

// Documents a run creates under fixed names; safe to close at any time.
function isLeftover(name) {
  return startsWith(name, "VF_WALK") || startsWith(name, "VF_FIG_");
}

// The working copy and its sheets. Only ours once this run has opened them.
function isWorkingCopy(name, title) {
  return !!title && (name === title || name === SHEET_PREFIX + title);
}

function isOurs(name, title) {
  return isLeftover(name) || isWorkingCopy(name, title);
}

function namesWhere(test) {
  var names = [];
  for (var i = 0; i < app.documents.length; i++) if (test(app.documents[i].name)) names.push(app.documents[i].name);
  return names;
}

function closeWhere(test) {
  var closed = 0;
  for (var i = app.documents.length - 1; i >= 0; i--) {
    if (test(app.documents[i].name)) {
      app.documents[i].close(SaveOptions.DONOTSAVECHANGES);
      closed++;
    }
  }
  return closed;
}

var result = "";
if (step == "open") {
  var title = arguments[2];
  closeWhere(isLeftover);
  // A document with the working title might be the artist's: refuse, don't close.
  if (namesWhere(function (n) { return isWorkingCopy(n, title); }).length) {
    result = "EXISTS";
  } else {
    var original = app.open(new File(arguments[1]));
    var copy = original.duplicate(title);
    original.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = copy;
    result = copy.name;
  }
} else if (step == "results") {
  for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name == "VF_WALK_RESULTS") result = app.documents[i].info.caption;
  }
} else if (step == "export") {
  var count = 0;
  for (var j = app.documents.length - 1; j >= 0; j--) {
    var d = app.documents[j];
    if (!startsWith(d.name, "VF_FIG_")) continue;
    app.activeDocument = d;
    var opts = new ExportOptionsSaveForWeb();
    opts.format = SaveDocumentType.JPEG;
    opts.quality = 66;
    opts.optimized = true;
    opts.includeProfile = false;
    d.exportDocument(new File(arguments[1] + "/" + d.name.substring(7) + ".jpg"), ExportType.SAVEFORWEB, opts);
    count++;
  }
  result = String(count);
} else if (step == "cleanup") {
  var cleanupTitle = arguments[1];
  result = String(closeWhere(function (n) { return isOurs(n, cleanupTitle); }));
} else if (step == "remaining") {
  var remainingTitle = arguments[1];
  result = namesWhere(function (n) { return isOurs(n, remainingTitle); }).join("\n");
} else if (step == "classify") {
  var lines = [];
  for (var k = 2; k < arguments.length; k++) lines.push(arguments[k] + "=" + isOurs(arguments[k], arguments[1]));
  result = lines.join("\n");
}
result;
