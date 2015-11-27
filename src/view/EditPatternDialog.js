var sandbox = require("sandbox");
var JSHINT = require("jshint").JSHINT;

define(["jquery","tinycolor","ace/ace","view/util.js","view/SelectList.js","view/patterns.js","view/LEDStripRenderer.js","view/ControlsView.js","view/CanvasPixelEditor","text!tmpl/editPatternDialog.html"],
function($,tinycolor,ace,util,SelectList,patterns,LEDStripRenderer,ControlsView,CanvasPixelEditor,desktop_template) {
    var This = function() {
        this.init.apply(this,arguments);
    }
    
    var defaultBody = '({\n\tcontrols:[\n\t\t{name: "Repetitions",id:"num",type:"numeric",default:"3"}\n\t],\n\tpattern:function(args) {\n\t\tthis.pixels=150;\n\t\tthis.frames=150;\n\t\tthis.fps=30;\n\t\tthis.render=function(x,t) {\n\t\t\tvar v = 360* ((x+t) % (this.pixels/parseInt(args.num)))/(this.pixels/parseInt(args.num))\n\t\t\treturn {h:v,s:100,v:100};\n\t\t}\n\t\treturn this;\n\t}\n})\n';

    function createCanvas(width,height) {
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        var g=canvas.getContext("2d");
        g.fillStyle = "#000";
        g.fillRect(0,0,width,height);

        return canvas;
    }

    function canvasToBytes(canvas) {
        var ctx=canvas.getContext("2d");
        var data = ctx.getImageData(0,0,canvas.width,canvas.height);
        var out = [];
        for (var n=0; n<data.height; n++) {
            for (var t=0; t<data.width; t++) {
                var i = n*4+t*data.width*4;
                out.push(data.data[i]);
                out.push(data.data[i+1]);
                out.push(data.data[i+2]);
            }
        }
        return out;
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

            if (!this.pattern.name) this.pattern.name = "New Pattern";

            this.$preview = this.$el.find(".patternPreview");
            this.stripRenderer = new LEDStripRenderer(150);
            this.$preview.empty().append(this.stripRenderer.$el);
            setTimeout(_.bind(function() {
                this.stripRenderer.resizeToParent();
            },this),5);

            this.$el.find(".titletext").text(this.pattern.name);
            this.$el.find(".titletext").click(_.bind(function() {
                var name = prompt("Pattern name",this.pattern.name);
                if (name == null) return;
                this.pattern.name = name;
                this.$el.find(".titletext").text(this.pattern.name);
            },this));

            this.$el.find(".patternControls").hide();
            this.$el.find(".saveButton").click(_.bind(this.savePatternClicked,this));

            if (this.pattern.type == "javascript") {
                if (!this.pattern.body) this.pattern.body = defaultBody;

                this.updateRendered();

                this.$el.find(".openConsole").click(_.bind(function() {
                    this.conduit.emit("OpenConsole");
                },this));
            } else if (this.pattern.type == "bitmap") {
                this.$el.find(".openConsole").hide();
                this.$el.find(".patternControls").show();

                this.canvas = createCanvas(200,150);
                $(this.canvas).css("border","1px solid black");

                this.editor = new CanvasPixelEditor(this.canvas);

                this.$fps = this.$el.find(".fps");
                this.$seconds = this.$el.find(".seconds");
                this.$pixels = this.$el.find(".pixels");

                if (!this.pattern.fps) this.pattern.fps = 1;
                if (!this.pattern.frames) this.pattern.frames = 5*this.pattern.fps;
                if (!this.pattern.pixes) this.pattern.pixels = 5;
                this.editor.setFps(this.pattern.fps);
                this.editor.setCanvasSize(this.pattern.frames,this.pattern.pixels);

                this.$fps.val(this.pattern.fps);
                this.$seconds.val(this.pattern.frames/this.pattern.fps);
                this.$pixels.val(this.pattern.pixels);

                this.$el.find(".patternControls input").change(_.bind(function() {
                    this.pattern.fps = parseFloat(this.$fps.val());
                    this.pattern.frames = parseFloat(this.$seconds.val())*this.pattern.fps;
                    this.pattern.pixels = parseInt(this.$pixels.val());

                    this.editor.setFps(this.pattern.fps);
                    this.editor.setCanvasSize(this.pattern.frames,this.pattern.pixels);
                    this.updateRendered();
                },this));

                $(this.editor).on("change",_.bind(function(e) {
                    this.doUpdateDelay();
                },this));

                this.$el.find(".editorcontainer").append(this.editor.$el);
                setTimeout(_.bind(function() {
                    this.editor.resizeToParent();
                },this),5);

                this.pattern.body = canvasToBytes(this.canvas);
                this.updateRendered();
                this.$el.find(".editorcontainer").append("<input type='file'>");
            }
        },
        savePatternClicked:function() {
            this.updatePattern();
            $(this).trigger("Save",this.pattern);
        },
        updatePattern:function() {
            if (this.pattern.type == "javascript") {
                this.pattern.body = this.editor.getValue();
            } else if (this.pattern.type == "bitmap") {
                this.pattern.body = canvasToBytes(this.canvas);
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
