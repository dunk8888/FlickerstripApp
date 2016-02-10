define(["jquery","tinycolor","view/util.js","view/SelectList.js","view/NotificationManager.js","view/LEDStripRenderer.js","view/ControlsView.js","text!tmpl/downloadPatternDialog.html"],
function($,tinycolor,util,SelectList,NotificationManager,LEDStripRenderer,ControlsView,desktop_template) {
    var This = function() {
        this.init.apply(this,arguments);
    }

    $.extend(This.prototype, {
        init:function(conduit,gui) {
            this.conduit = conduit;
            this.gui = gui;
            this.$el = $("<div class='downloadPatternDialog modal largemodal'/>");

            this.$el.append(desktop_template);
            this.$el = this.$el.children();

            this.$el.find(".hideButton").click(_.bind(function() {
                this.hide()
            },this));

            this.$preview = this.$el.find(".patternPreview");

            this.conduit.request("GetUser",_.bind(function(user) {
                this.user = user;
            },this));

            var ledCount = 150;
            this.stripRenderer = new LEDStripRenderer(ledCount);
            this.$preview.empty().append(this.stripRenderer.$el);
            this.$el.find(".serverPatterns").addClass("empty");
            this.refreshPatterns();

            this.$el.find(".deletePattern").click(_.bind(this.deletePatternClicked,this));
            this.$el.find(".previewPattern").click(_.bind(this.previewPatternClicked,this));

            this.$el.find(".downloadPattern").click(_.bind(this.doDownloadPattern,this));
        },
        refreshPatterns:function() {
            this.$el.find(".right").addClass("deselected");
            this.conduit.request("RefreshServerPatterns",_.bind(function(patterns) {
                this.patternSelect = new SelectList(patterns,this.patternOptionRenderer,{multiple:false});
                this.$el.find(".serverPatterns").empty().append(this.patternSelect.$el).removeClass("empty");
                $(this.patternSelect).on("change",_.bind(this.patternSelected,this));
            },this));
        },
        doDownloadPattern:function() {
            NotificationManager.notify("info","Lightwork downloaded: "+this.selectedPattern.name,1000);
            $(this).trigger("DownloadPattern",this.selectedPattern);
        },
        getPattern:function(patternSpec) { //TODO dedupe me
            var args = {};
            if (patternSpec.controls) {
                _.each(patternSpec.controls,function(control) {
                    args[control.id] = control.default;
                });
            }
            if (typeof(patternSpec.pattern) === "function") return patternSpec.pattern(args);
            return patternSpec.pattern;
        },
        previewPatternClicked:function() {
            util.evaluatePattern(this.selectedPattern,null);
            this.conduit.emit("LoadPattern",this.gui.selectedStrips[0].id,this.selectedPattern,true);
        },
        deletePatternClicked:function() {
            if (!this.selectedPattern) return;
            this.conduit.request("DeletePattern",this.selectedPattern.id,_.bind(function() {
                this.refreshPatterns();
            },this));
        },
        patternSelected:function(e,selectedObjects,selectedIndexes) {
            if (selectedObjects.length == 0) return;

            var pattern = selectedObjects[0];
            this.conduit.request("LoadServerPattern",pattern.id,_.bind(function(id,body) {
                if (pattern.type == "bitmap") {
                    body = Buffer(body,"base64");
                    var arr = [];
                    for(var i = 0; i < body.length; i++){
                      arr.push(body[i]);
                    };
                    body = arr;
                }
                this.$el.find(".right").toggleClass("deselected",selectedObjects.length == 0);
                this.$el.find(".deletePattern").toggle(true == (this.user && pattern.Owner.id === this.user.id));
                pattern.body = body;
                this.selectedPattern = pattern;
                if (!pattern.type) pattern.type = "javascript";
                util.evaluatePattern(this.selectedPattern);

                this.stripRenderer.setPattern(pattern.rendered);

                //update titlebar
                var frameInfo = pattern.rendered.frames > 1 ? (pattern.rendered.frames/pattern.rendered.fps).toFixed(2)+"s" : "static";
                this.$el.find(".patternTitle").text(pattern.name+ " ("+frameInfo+")");

                setTimeout(_.bind(function() {
                    this.stripRenderer.resizeToParent();
                },this),5);
            },this));
        },
        patternOptionRenderer:function(pattern,$el) {
            if ($el) {
                $el.find(".name").text(pattern.name);
                $el.find(".aside").text(pattern.Owner.display);
            } else {
                $el = $("<ul class='list-group-item listElement' />");
                $el.append($("<span class='name'></span>").text(pattern.name));
                $el.append($("<span class='aside'></span>").text(pattern.Owner.display));
            }
            return $el;
        },
        show:function() {
            if (platform == "mobile") {
                var $mainContainer = $(document.body).find(".mainContainer");
                $mainContainer.append(this.$el);
            } else {
                $(document.body).append(this.$el);
                this.$el.modal('show');
            }
            
            setTimeout(function() {
                $(document.body).addClass("loadPatternShowing");
            },5);
            return this;
        },

        hide:function() {
            var $body = $(document.body);
            $(document.body).removeClass("loadPatternShowing");
            $(document.body).removeClass("configurePatternShowing");
            this.$el.find(".hideButton").unbind("click");

            if (platform == "desktop") {
                this.$el.modal('hide');
                this.$el.remove();
            } else if (platform == "mobile") {
                setInterval(_.bind(function() { //delay until the animation finishes
                    this.$el.remove();
                },this),500);
            }

            if (this.stripRenderer) this.stripRenderer.destroy();
            return this;
        }
    });

    return This;
});
