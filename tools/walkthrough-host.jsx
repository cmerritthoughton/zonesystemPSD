// ExtendScript helper for tools/make-walkthrough.sh.
// arguments[0] is the step: open <image> <title> | results | export <dir> | cleanup <title>.
var step = arguments[0];

function quote(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function closeMatching(re) {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    if (re.test(app.documents[i].name)) app.documents[i].close(SaveOptions.DONOTSAVECHANGES);
  }
}

var result = "";
if (step == "open") {
  // Leftovers of an earlier run are ours; a document with the working title
  // might be the artist's, so refuse rather than close it.
  closeMatching(/^VF_WALK|^VF_FIG_/);
  var taken = new RegExp("^(Opportunities — )?" + quote(arguments[2]) + "$");
  for (var k = 0; k < app.documents.length; k++) if (taken.test(app.documents[k].name)) result = "EXISTS";
  if (result != "EXISTS") {
    var original = app.open(new File(arguments[1]));
    var copy = original.duplicate(arguments[2]);
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
    if (d.name.indexOf("VF_FIG_") !== 0) continue;
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
  closeMatching(new RegExp("^VF_WALK|^VF_FIG_|^(Opportunities — )?" + quote(arguments[1]) + "$"));
  result = "ok";
}
result;
