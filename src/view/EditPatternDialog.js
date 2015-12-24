var sandbox = require("sandbox");
var JSHINT = require("jshint").JSHINT;

define(["jquery","tinycolor","ace/ace","view/util.js","view/SelectList.js","view/patterns.js","view/LEDStripRenderer.js","view/ControlsView.js","view/CanvasPixelEditor","text!tmpl/editPatternDialog.html"],
function($,tinycolor,ace,util,SelectList,patterns,LEDStripRenderer,ControlsView,CanvasPixelEditor,desktop_template) {
    var This = function() {
        this.init.apply(this,arguments);
    }
    
    var defaultBody = '({\n\tcontrols:[\n\t\t{name: "Repetitions",id:"num",type:"numeric",default:"3"}\n\t],\n\tpattern:function(args) {\n\t\tthis.pixels=150;\n\t\tthis.frames=150;\n\t\tthis.fps=30;\n\t\tthis.render=function(x,t) {\n\t\t\tvar v = 360* ((x+t) % (this.pixels/parseInt(args.num)))/(this.pixels/parseInt(args.num))\n\t\t\treturn {h:v,s:100,v:100};\n\t\t}\n\t\treturn this;\n\t}\n})\n';

    var defaultPixelPattern = {
        pixels:7,
        fps:3,
        frames:7,
        type:"bitmap",
        body:[0,0,0,0,0,0,0,0,0,251,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,251,255,0,255,170,0,251,255,0,0,0,0,0,0,0,0,0,0,251,255,0,255,170,0,255,0,0,255,170,0,251,255,0,0,0,0,251,255,0,255,170,0,255,0,0,255,255,255,255,0,0,255,170,0,251,255,0,0,0,0,251,255,0,255,170,0,255,0,0,255,170,0,251,255,0,0,0,0,0,0,0,0,0,0,251,255,0,255,170,0,251,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,251,255,0,0,0,0,0,0,0,0,0,0],
        palette:[
            [0,0,0],
            [255,255,255],
            [255,0,0],
            [255,255,0],
            [0,255,0],
            [0,255,255],
            [0,0,255]
        ]
    };

    function resizePalette(original,paletteSize) {
        var palette = $.extend([],original);
        while(palette.length < paletteSize) palette.push([255,255,255]);
        while(palette.length > paletteSize) palette.pop();
        return palette;
    }

    function createCanvas(width,height) {
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        var g=canvas.getContext("2d");
        g.fillStyle = "#000";
        g.fillRect(0,0,width,height);

        return canvas;
    }

    $.extend(This.prototype, {
        init:function(conduit,gui,pattern) {
            this.conduit = conduit;
            this.pattern = $.extend({},pattern);
            this.gui = gui;
			this.widgets = [];
            this.$el = $("<div class='editPatternDialog'/>");

            this.$el.append(desktop_template);
            this.$el = this.$el.children();

            this.$el.find(".hideButton").click(_.bind(function() {
                this.hide()
            },this));

            //util.testFunctions();

            if (!this.pattern.name) this.pattern.name = "New Pattern";

            this.$preview = this.$el.find(".patternPreview");
            this.stripRenderer = new LEDStripRenderer(150);
            this.$preview.empty().append(this.stripRenderer.$el);
            setTimeout(_.bind(function() {
                this.stripRenderer.resizeToParent();
            },this),5);

            $(window).on("resize",_.bind(function() {
                this.stripRenderer.resizeToParent();
                this.editor.resizeToParent();
            },this));

            this.$el.find(".titletext").text(this.pattern.name);
            this.$el.find(".titletext").click(_.bind(function() {
                var name = prompt("Pattern name",this.pattern.name);
                if (name == null) return;
                this.pattern.name = name;
                this.$el.find(".titletext").text(this.pattern.name);
            },this));

            this.$el.find(".patternControls").addClass("hide");
            this.$el.find(".saveButton").click(_.bind(this.savePatternClicked,this));

            if (this.pattern.type == "javascript") {
                if (!this.pattern.body) this.pattern.body = defaultBody;

                this.updateRendered();

                this.$el.find(".openConsole").click(_.bind(function() {
                    this.conduit.emit("OpenConsole");
                },this));
            } else if (this.pattern.type == "bitmap") {
                this.$el.find(".openConsole").hide();
                this.$el.find(".patternControls").removeClass("hide");

                this.$el.find(".loadImage").click(_.bind(function() {
                    util.openFileDialog(this.$el,{
                        accepts:"*.png,*.gif,*.jpg,*.jpeg"
                    },_.bind(function(path) {
                        if (!path) return;
                        this.conduit.request("OpenImage",path,_.bind(function(width,height,pixels) {
                            var transpose = true;
                            this.canvas = util.renderPattern(pixels,width,height,null,null,transpose);
                            this.editor.setImage(this.canvas);
							this.editor.setFps(this.pattern.fps);

                            this.pattern.frames = transpose ? height : width;
                            this.pattern.pixels = transpose ? width : height;

                            this.updateEditor();
                            this.updatePattern();
                        },this));
                    },this));
                            
                },this));
                this.$el.find(".saveImage").click(_.bind(function() {
                    util.openFileDialog(this.$el,{
                        nwsaveas:"pattern.png"
                    },_.bind(function(path) {
                        var dataUrl = this.canvas.toDataURL();
                        this.conduit.emit("SaveImage",dataUrl,path);
                    },this));
                },this));

                this.pattern = $.extend({},defaultPixelPattern,this.pattern);
                var palette = resizePalette(this.pattern.palette,10);
                this.editor = new CanvasPixelEditor(null,palette);
                $(this.editor).on("PaletteUpdated",_.bind(function(e,palette) {
                    console.log("palette updated",arguments);
                    this.pattern.palette = palette;
                },this));
                
                this.$fps = this.$el.find(".fps");
                this.$frames = this.$el.find(".frames");
                this.$pixels = this.$el.find(".pixels");

                this.updateEditor();

                $(this.canvas).css("border","1px solid black");

                this.canvas = util.renderPattern(this.pattern.body,this.pattern.pixels,this.pattern.frames,null,null,false,false);
                this.editor.setImage(this.canvas);

                this.$el.find(".patternControls input").change(_.bind(function() {
                    this.pattern.fps = parseFloat(this.$fps.val());
                    this.pattern.frames = parseFloat(this.$frames.val())
                    this.pattern.pixels = parseInt(this.$pixels.val());

                    this.updateEditor();
                    this.updatePattern();
                },this));

                $(this.editor).on("change",_.bind(function(e) {
                    this.doUpdateDelay();
                },this));

                this.$el.find(".controls").replaceWith(this.editor.$controls);
                this.$el.find(".editorcontainer").append(this.editor.$el);
                setTimeout(_.bind(function() {
                    this.editor.resizeToParent();
                },this),5);

                this.pattern.body = util.canvasToBytes(this.canvas);
                this.updateRendered();
            }
        },
        updateEditor:function() {
            this.$frames.val(this.pattern.frames);
            this.$pixels.val(this.pattern.pixels);
            this.$fps.val(this.pattern.fps);
            this.editor.setFps(this.pattern.fps);
            this.editor.setCanvasSize(this.pattern.pixels,this.pattern.frames);
        },
        savePatternClicked:function() {
            this.updatePattern();
            $(this).trigger("Save",this.pattern);
        },
        updatePattern:function() {
            if (this.pattern.type == "javascript") {
                this.pattern.body = this.editor.getValue();
            } else if (this.pattern.type == "bitmap") {
                this.pattern.body = util.canvasToBytes(this.canvas,false);
            }

            this.updateRendered();
        },
        updateRendered:function() {
            util.evaluatePattern(this.pattern);
            this.stripRenderer.setPattern(this.pattern.rendered);
        },
        doUpdateDelay:function() {
            if (this.updateDelay) clearTimeout(this.updateDelay);
            this.updateDelay = setTimeout(_.bind(this.updatePattern,this),500);
        },
        show:function() {
            if (platform == "mobile") {
                var $mainContainer = $(document.body).find(".mainContainer");
                $mainContainer.append(this.$el);
            } else {
                $(document.body).append(this.$el);
                this.$el.modal('show');

                if (this.pattern.type == "javascript") {
                    this.editor = ace.edit(this.$el.find(".editorcontainer").get(0));
                    this.editor.setValue(this.pattern.body);
                    this.editor.setTheme("ace/theme/monokai");
                    this.editor.getSession().setMode("ace/mode/javascript");
                    this.editor.getSession().on('change',_.bind(this.doUpdateDelay,this));
                    this.editor.gotoLine(0);
                }
            }
            
            setTimeout(function() {
                $(document.body).addClass("loadPatternShowing");
            },5);
            return this;
        },

        hide:function() {
            var $body = $(document.body);
                this.$el.modal('hide');
                this.$el.remove();
            if (this.stripRenderer) this.stripRenderer.destroy();
            return this;
        }
    });

    return This;
});
