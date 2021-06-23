/**
 *
 * EUNOMIAC'S TEXT CONTROLS FOR ROLL20
 *
 *      Version: 0.1-alpha
 *      Date: June 23, 2001
 *      GitHub: https://github.com/Eunomiac/-EunosTextControls
 *
 */

const EunosTextControls = (() => {
    // #region *** *** FRONT *** ***

    // #region      Front: Basic References
    const ROOTNAME = "Euno";
    const RO = {get OT() { return ROOTNAME in state ? state[ROOTNAME] : false }};

    const SCRIPTNAME = "EunosTextControls";
    const STA = {get TE() { return (RO.OT && SCRIPTNAME in RO.OT) ? RO.OT[SCRIPTNAME] : false}};

    const DEFAULTSTATE = { // Initial values for state storage.
        CHARWIDTHS: {},
        REGISTRY: {},
        IsAutoRegistering: false,
        IsShowingIntro: true
    };
    const CHAR = {get WIDTHS() { return (STA.TE && "CHARWIDTHS" in STA.TE) ? STA.TE.CHARWIDTHS : false }};
    const RE = {get G() { return (STA.TE && "REGISTRY" in STA.TE) ? STA.TE.REGISTRY : {} }};
    // #endregion

    // #region      Front: Initialization
    const Initialize = (isRegisteringEventListeners = false, isResettingState = false) => {

        state[ROOTNAME] = state[ROOTNAME] || {};

        // Initialize state storage with DEFAULTSTATE where needed.
        if (isResettingState) { delete RO.OT[SCRIPTNAME] }
        RO.OT[SCRIPTNAME] = RO.OT[SCRIPTNAME] || {};
        Object.entries(DEFAULTSTATE).filter(([key]) => !(key in STA.TE)).forEach(([key, defaultVal]) => { STA.TE[key] = defaultVal });

        // Register event handlers for chat commands and text object changes.
        if (isRegisteringEventListeners) {
            on("chat:message", handleMessage);
            on("change:text", handleTextChange);
            on("add:text", handleTextAdd);
            on("destroy:text", handleTextDestroy);
        }

        // Report Readiness.
        flagGM(`${SCRIPTNAME} Ready!`);
        log(`${SCRIPTNAME} Ready!`);

        // Display intro message if toggled:
        if (STA.TE.IsShowingIntro) { displayIntroMessage() }

        // Display status of automatic text shadowing
        displayAutoShadowStatus();
    };
    // #endregion

    // #region      Front: Event Handlers
    const handleMessage = (msg) => {
        if (msg.content.startsWith("!ets") && playerIsGM(msg.playerid)) {
            let [call, ...args] = (msg.content.match(/!\S*|\s@"[^"]*"|\s@[^\s]*|\s"[^"]*"|\s[^\s]*/gu) || [])
                .map((x) => x.replace(/^\s*(@)?"?|"?"?\s*$/gu, "$1"))
                .filter((x) => Boolean(x));
            ({
                help: displayIntroMessage,
                shadow: () => makeTextShadow(getSelTextObjs(msg)),
                toggle: () => toggleAutoShadow(args.includes("true")),
                clear: () => {
                    if (args.includes("all")) {
                        Object.entries(RE.G).filter(([id, textData]) => "masterID" in textData).forEach(([id, textData]) => unregTextShadow(id));
                        flagGM("Shadow objects removed.<br>Registered shadows cleared.");
                        displayAutoShadowToggleMenu();
                    } else {
                        const textObjs = getSelTextObjs(msg);
                        if (textObjs) {
                            textObjs.forEach((obj) => unregTextShadow(obj.id));
                        }
                    }
                },
                fix: () => { if (args.includes("all")) { fixTextShadows() } },
                cancelintro: () => { STA.TE.IsShowingIntro = false; flagGM("Disabling Script Introduction.") }
            }[(call = args.shift() || "").toLowerCase()] || (() => false))();
        }
    };
    const handleTextChange = (textObj, prevData) => {
        if (textObj.id in RE.G) {
            const [masterObj, shadowObj] = [
                RE.G[textObj.id].shadowID ? textObj : getObj("text", RE.G[textObj.id].masterID),
                RE.G[textObj.id].masterID ? textObj : getObj("text", RE.G[textObj.id].shadowID)
            ];
            if (masterObj && shadowObj) {
                syncShadow(masterObj, shadowObj);
            }
        }
    };
    const handleTextAdd = (textObj) => {
        if (STA.TE.IsAutoRegistering && !isShadowObj(textObj)) {
            makeTextShadow(textObj);
        }
    };
    const handleTextDestroy = (textObj) => {
        if (textObj.id in RE.G) {
            const textData = RE.G[textObj.id];
            if (isShadowObj(textObj)) {
                const masterObj = getObj("text", textData.masterID);
                unregTextShadow(textObj.id);
                if (masterObj && !removalQueue.includes(textObj.id)) {
                    alertGM(HTML.Box([
                        HTML.Header("ERROR: Manual Shadow Removal"),
                        HTML.Block([
                            "<h3>Recreating Destroyed Text Shadow</h3>",
                            "<p>Manually-deleted text shadows are automatically recreated (to prevent accidentally deleting a desired shadow).</p>",
                            "<p>To remove a text shadow from a text object:</p>",
                            `<p>${HTML.CodeSpan("!ets clear")} — Removes text shadows from all selected text objects <i>(you can select either the master object, the shadow object, or both)</i></p>`,
                            `<p>${HTML.CodeSpan("!ets clear all")} — Remove <b><u>ALL</u></b> text shadow objects <i>(this will not affect the master text objects, just remove the shadows)</i></p>`
                        ].join(""))
                    ].join("")));
                    makeTextShadow(masterObj);
                }
            } else if (textData.shadowID) {
                safeRemove(textData.shadowID);
            }
        }
    };
    // #endregion

    // #endregion *** *** FRONT *** ***

    // #region *** *** CONFIGURATION *** ***

    // #region      Configuration: Text Shadows
    const SHADOWOFFSETS = {
        /** The number of pixels to offset each text shadow, depending on the font size and family of the master object.
          * The first number is the horizontal shift, the second is the vertical shift.
          *
          * If any shadows appear too close or too far from each other for a given font size, tweaking the values here
          * and then running "!ets fix all" will update all text objects with new offsets.
          *
          * Generic values are used UNLESS a specific override for that font-family and size exists.
          *     Overrides can be delivered via getters and the scaleOffsets() function if they're simple multiples (see examples below),
          *     ... OR you can define custom values for each font size (see e.g. "Contrail One", below, which is just an example and no different from generic) */
        generic: {
            12: [2, 2],
            14: [2, 2],
            16: [2, 2],
            18: [2, 2],
            20: [2, 2],
            22: [2, 2],
            26: [2.5, 2.5],
            32: [3, 3],
            40: [3, 3],
            56: [5, 5],
            72: [7, 7],
            100: [8, 8],
            200: [16, 16]
        },
        get "Shadows Into Light"() {
            return scaleOffsets(SHADOWOFFSETS.generic, 0.5); // Returns a copy of the provided offset table, with its values scaled by the multiplier.
        },                                                   //   * Can submit different TOP and LEFT values by passing an array, i.e. [<leftMult>, <topMult>]
        get "Arial"() {
            return scaleOffsets(SHADOWOFFSETS.generic, 0.6);
        },
        get "Patrick Hand"() {
            return scaleOffsets(SHADOWOFFSETS.generic, 0.75);
        },
        "Contrail One": {
            12: [2, 2],
            14: [2, 2],
            16: [2, 2],
            18: [2, 2],
            20: [2, 2],
            22: [2, 2],
            26: [2.5, 2.5],
            32: [3, 3],
            40: [3, 3],
            56: [5, 5],
            72: [7, 7],
            100: [8, 8],
            200: [16, 16]
        }
    };
    const SHADOWLAYER = "map"; /** The layer containing shadow objects.
                                * Keeping master objects on the Objects layer and shadow objects on the Map layer makes
                                * it easier to manipulate the master objects without the shadows getting in your way.
                                * (Keeping both on the map layer also works well!) */
    const SHADOWCOLOR = "rgb(1,1,1)"; /** Change this value (hex, color names and rgb/a values are all valid) to change the color assigned
                                        * to text shadow objects.
                                        *                         *** IMPORTANT: *** THIS VALUE MUST BE UNIQUE (i.e. not used as a color for any non-shadow text
                                        *                                            objects), as the script relies on this value to distinguish shadow objects
                                        *                                            from standard text objects.  */

    // #endregion

    // #endregion *** *** CONFIGURATION *** ***

    // #region *** *** UTILITY *** ***

    const parseStyles = (styleData) => {
        // Parse object containing CSS styles to inline style attribute.
        if (typeof styleData === "string") {
            return styleData.replace(/\s{2,}/gu, " ");
        } else {
            return Object.entries(styleData).map(([prop, val]) => `${prop}: ${val}`).join("; ");
        }
    };
    const getR20Type = (val) => { // Returns specific type/subtype of R20 object, or false if val isn't an R20 object.
        if (_.isObject(val) && val.id && "get" in val) {
            const type = val.get("_type");
            if (type === "graphic") {
                if (val.get("represents")) {
                    return "token";
                }
                if (val.get("_subtype") === "card") {
                    return "card";
                }
                if (/\.webm/u.test(val.get("imgsrc"))) {
                    return "animation";
                }
                return "graphic";
            }
            return type;
        }
        return false;
    };
    const isShadowObj = (val) => getR20Type(val) === "text" && val.get("color") === SHADOWCOLOR;
    const getSelTextObjs = (msg) => { // Returns an array of selected text objects.
        if (msg.selected && msg.selected.length) {
            return msg.selected.filter((objData) => objData._type === "text").map((objData) => getObj("text", objData._id));
        }
        return false;
    };
    const jS = (val) => JSON.stringify(val, null, 2).replace(/\n/g, "<br>").replace(/ /g, "&nbsp;"); // Stringification for display in R20 chat.
    const jC = (val) => HTML.CodeBlock(jS(val)); // Stringification for data objects and other code for display in R20 chat.
    const alertGM = (content, title) => { // Simple alert to the GM. Style depends on presence of content, title, or both.
        const randStr = () => _.sample("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""), 4).join("");
        if (content || title) {
            if (title) {
                if (content === null) {
                    sendChat(randStr(), `/w gm ${HTML.Box(HTML.Header(title, "#555"))}`, null, {noarchive: true});
                } else {
                    sendChat(randStr(), `/w gm ${HTML.Box([
                        HTML.Header(title, "#555"),
                        HTML.Block(content)
                    ].join(""))}`, null, {noarchive: true});
                }
            } else {
                sendChat(randStr(4), `/w gm ${content}`, null, {noarchive: true});
            }
        }
    };
    const showGM = (obj, title = "Showing ...") => alertGM(jC(obj), title); // Show properties of stringified object to GM.
    const flagGM = (msg) => alertGM(null, msg); // Simple one-line chat flag sent to the GM.
    const keyMapObj = (obj, keyFunc = (x) => x, valFunc = undefined) => {
        /* An object-equivalent Array.map() function, which accepts mapping functions to transform both keys and values.
         *      If only one function is provided, it's assumed to be mapping the values and will receive (v, k) args. */
        [valFunc, keyFunc] = [valFunc, keyFunc].filter((x) => typeof x === "function" || typeof x === "boolean");
        keyFunc = keyFunc || ((k) => k);
        valFunc = valFunc || ((v) => v);
        const newObj = {};
        Object.entries(obj).forEach(([key, val]) => {
            newObj[keyFunc(key, val)] = valFunc(val, key);
        });
        return newObj;
    };
    const scaleOffsets = (sourceOffsets, multiplier) => keyMapObj(
        sourceOffsets,
        (v) => {
            if (Array.isArray(multiplier)) {
                return [v[0] * multiplier[0], v[1] * multiplier[1]];
            }
            return [v[0] * multiplier, v[1] * multiplier];
        }
    );

    // #endregion *** *** UTILITY *** ***

    // #region *** *** FEATURE: TEXT SHADOWS *** ***
    const removalQueue = [];

    // #region      Text Shadows: Creation & Toggling Automatic Creation
    const makeTextShadow = (masterObjs) => {
        [masterObjs].flat().forEach((masterObj) => {
            let isSkipping = false;
            if (masterObj.id in RE.G) {
                if (RE.G[masterObj.id].shadowID) {
                    unregTextShadow(RE.G[masterObj.id].shadowID);
                } else if (RE.G[masterObj.id].masterID) {
                    flagGM("Cannot add a shadow to an existing text shadow object!");
                    isSkipping = true;
                }
            }
            if (!isSkipping) {
                if (getR20Type(masterObj) === "text") {
                    const shadowOffsets = SHADOWOFFSETS[masterObj.get("font_family") in SHADOWOFFSETS ? masterObj.get("font_family") : "generic"];
                    const shadowObj = createObj("text", {
                        _pageid: masterObj.get("_pageid"),
                        left: masterObj.get("left") + shadowOffsets[masterObj.get("font_size")][0],
                        top: masterObj.get("top") + shadowOffsets[masterObj.get("font_size")][1],
                        text: masterObj.get("text"),
                        font_size: masterObj.get("font_size"),
                        rotation: masterObj.get("rotation"),
                        font_family: masterObj.get("font_family"),
                        color: SHADOWCOLOR,
                        layer: SHADOWLAYER,
                        controlledby: ""
                    });
                    regTextShadow(masterObj, shadowObj);
                }
            }
        });
    };
    const toggleAutoShadow = (isActive) => {
        if (isActive === true) {
            STA.TE.IsAutoRegistering = true;
        } else if (isActive === false) {
            STA.TE.IsAutoRegistering = false;
        }
        displayAutoShadowStatus();
    };
    // #endregion

    // #region      Text Shadows: Registering & Unregistering Master/Shadow Pairs
    const regTextShadow = (masterObj, shadowObj) => {
        RE.G[masterObj.id] = {
            id: masterObj.id,
            shadowID: shadowObj.id
        };
        RE.G[shadowObj.id] = {
            id: shadowObj.id,
            masterID: masterObj.id
        };
        toFront(masterObj);
        toFront(shadowObj);
    };
    const safeRemove = (ids) => {
        [ids].flat().forEach((id) => {
            const textObj = getObj("text", id);
            if (textObj) {
                removalQueue.push(id);
                textObj.remove();
            }
        });
    };
    const unregTextShadow = (ids) => {
        [ids].flat().forEach((id) => {
            if (id in RE.G) {
                const textData = RE.G[id];
                if (textData.masterID in RE.G) {
                    safeRemove(id);
                    delete RE.G[textData.masterID];
                    delete RE.G[id];
                } else if (textData.shadowID in RE.G) {
                    unregTextShadow(textData.shadowID);
                }
            }
        });
    };
    // #endregion

    // #region      Text Shadows: Synchronizing Master/Shadow Objects
    const syncShadow = (masterObj, shadowObj) => {
        // Where the magic happens (?) --- synchronizing text shadows to their master objects, whenever they're changed or created.
        if (getR20Type(masterObj) && getR20Type(shadowObj)) {
            const shadowOffsets = SHADOWOFFSETS[masterObj.get("font_family") in SHADOWOFFSETS ? masterObj.get("font_family") : "generic"];
            shadowObj.set({
                text: masterObj.get("text"),
                left: masterObj.get("left") + shadowOffsets[masterObj.get("font_size")][0],
                top: masterObj.get("top") + shadowOffsets[masterObj.get("font_size")][1],
                layer: SHADOWLAYER,
                color: SHADOWCOLOR,
                font_family: masterObj.get("font_family"),
                rotation: masterObj.get("rotation"),
                font_size: masterObj.get("font_size"),
                controlledby: ""
            });
            toFront(shadowObj);
            toFront(masterObj);
        }
    };
    const fixTextShadows = () => {
        // Validates Registry & Sandbox Objects, Synchronizing where necessary.

        // ONE: Locate all shadow objects in the sandbox, by referencing unique SHADOWCOLOR value (see *** CONFIGURATION ***)
        const allShadowObjs = findObjs({
            _type: "text",
            color: SHADOWCOLOR
        });
        allShadowObjs.forEach((shadowObj) => {
            if (!(shadowObj.id in RE.G)) { // If shadow object isn't in registery, it's an orphan: kill it with fire.
                shadowObj.remove();
            }
        });

        // TWO: Group registered text objects by whether they're a master object or a shadow, then check that each registered
        // master is paired with a registered shadow, and vice versa.
        const regTextObjs = _.groupBy(Object.values(RE.G), (data) => "masterID" in data ? "ShadowObjs" : "MasterObjs");
        regTextObjs.ShadowObjs = _.groupBy(regTextObjs.ShadowObjs, (data) => data.id);
        regTextObjs.MasterObjs = _.groupBy(regTextObjs.MasterObjs, (data) => data.id);

        for (const [id, shadowData] of Object.entries(regTextObjs.ShadowObjs)) {
            const shadowObj = getObj("text", id);
            const masterObj = getObj("text", shadowData.masterID);
            if (shadowObj && masterObj) { // ... and, if they ARE paired, sync them for position & content.
                RE.G[shadowObj.id].masterID = masterObj.id;
                RE.G[masterObj.id].shadowID = shadowObj.id;
                syncShadow(masterObj, shadowObj);
            } else if (masterObj && !shadowObj) {
                makeTextShadow(masterObj);
            } else if (!masterObj) {
                unregTextShadow(id);
            }
        }

        flagGM("Text Shadows Synchronized.");
    };
    // #endregion

    // #endregion *** *** TEXT SHADOWS *** ***

    // #region *** *** HTML *** ***

    // #region      HTML: Styles

    const CHATWIDTH = 270; // The minimum width of the chat panel, in pixels.

    const UPSHIFT = -25;   // Constants governing how the chat box is positioned in the chat panel: By default, everything
    const LEFTSHIFT = -42; // shifts up and to the left to cover the standard chat output with the custom styles below.
    const BOTTOMSHIFT = 0;

    const HTML = {
        Box: (content) => `<div style="${parseStyles(`
                display: block;
                width: auto; min-width: ${CHATWIDTH}px;
                height: auto; min-height: 14px;
                margin: ${UPSHIFT}px 0 ${BOTTOMSHIFT}px ${LEFTSHIFT}px;
                padding: 0;
                text-align: center; text-align-last: center;
                position: relative;
                border: none; text-shadow: none; box-shadow: none;
                background: white;
                outline: 2px solid black;
                overflow: hidden;
            `)}">${[content].flat().join("")}</div>`,
        Block: (content, bgColor = "white", fontFamily = "serif", fontWeight = "normal", fontSize = 14, lineHeight) => `<div style="${parseStyles({
            "width": "97%",
            "margin": "2px 0 0 0",
            "padding": "1.5%",
            "text-align": "left", "text-align-last": "left",
            "background": bgColor,
            "font-family": `'${fontFamily}'`,
            "font-weight": fontWeight,
            "font-size": `${fontSize}px`,
            "line-height": `${lineHeight ? lineHeight : fontSize + 4}px`
        })}">${[content].flat().join("")}</div>`,
        Header: (content, bgColor = "rgba(80,80,80,1)") => `<span style="${parseStyles({
            "display": "block",
            "height": "auto",
            "width": "auto",
            "margin": "0",
            "padding": "0 5px",
            "text-align": "left", "text-align-last": "left",
            "color": "white",
            "font-family": "sans-serif",
            "font-size": "16px",
            "line-height": "24px",
            "font-variant": "small-caps",
            "background-color": bgColor,
            "border": "none", "text-shadow": "none", "box-shadow": "none"
        })}">${[content].flat().join("")}</span>`,
        CodeBlock: (content, bgColor = "white") => HTML.Block(content, bgColor, "monospace", "bold", 8),
        CodeSpan: (content) => `<span style="${parseStyles({
            "display": "inline-block",
            "font-family": "monospace",
            "font-weight": "bolder",
            "font-size": "12px",
            "background": "#AAA",
            "padding": "0 5px"
        })}">${[content].flat().join("")}</span>`,
        Button: (name, command, width = "100%") => `<span style="${parseStyles({
            "display": "inline-block",
            "width": `${width}`,
            "color": "white",
            "text-align": "center"
        })}"><a href="${command}" style="${parseStyles(`
                    width: 90%;
                    background: gold;
                    color: black;
                    font-family: sans-serif;
                    text-transform: uppercase;
                    font-weight: bold;
                    border-radius: 10px;
                    border: 2px outset #666;
                    line-height: 14px;
                `)}">${name}</a></span>`,
        H: (content, level = 3) => `<h${level}>${content}</h${level}>`,
        Paras: (content) => [content].flat().map((para) => `<p>${para}</p>`).join(""),
        Span: (content, bgColor = "none", color = "black", fontSize = "14px", lineHeight = "18px") => `<span style="${parseStyles(`
                display: inline-block;
                background: ${bgColor};
                color: ${color};
                font-size: ${fontSize};
                line-height: ${lineHeight};
            `)}">${content}</span>`,
        Img: (imgSrc) => `<img src="${imgSrc}">`
    };
    // #endregion

    // #region      HTML: Chat Displays & Menus
    const displayIntroMessage = () => {
        alertGM(HTML.Box([
            HTML.Header("Eunomiac's Text Controls v.0.1"),
            HTML.Block([
                HTML.Img("https://raw.githubusercontent.com/Eunomiac/-EunosTextControls/master/images/Header%20-%20Text%20Shadows%200.1.jpg"),
                HTML.Paras([
                    "Add pleasant shadows to sandbox text objects in Roll20 — either <b>automatically</b>, whenever new text is added to the sandbox, or <b>manually</b>, by selecting text objects and registering them for a shadow via the commands below.",
                    "Shadow objects are intended to be hands off: They're created automatically when registered, will update whenever their master text object's position and/or content changes, and will be removed if the master object is ever deleted."
                ]),
                HTML.H("Automatic Configuration"),
                HTML.Paras([
                    `${HTML.CodeSpan("!ets toggle true")} — This will toggle <b>ON</b> the automatic creation of text shadows for <b><u>ALL</u></b> new text objects, applied when they are first added to the sandbox by any player.  <i>(You can then remove text shadows from specific text objects by selecting them and running <b>!ets clear</b>, as described below.)</i>`,
                    `${HTML.CodeSpan("!ets toggle false")} — Toggle <b>OFF</b> automatic shadow creation.`
                ]),
                HTML.H("Individual Configuration"),
                HTML.Paras([
                    `${HTML.CodeSpan("!ets shadow")} — <b>ADD</b> shadow(s) to all selected text objects.`,
                    `${HTML.CodeSpan("!ets clear")} — <b>REMOVE</b> shadow(s) from all selected text objects <i>(you can select either master objects and/or shadow objects for this command)</i>`
                ]),
                HTML.H("Global Commands"),
                HTML.Paras([
                    `${HTML.CodeSpan("!ets help")} — View this help message.`,
                    `${HTML.CodeSpan("!ets clear all")} — <b>REMOVE <u>ALL</u></b> text shadow objects <i>(this will not affect the master text objects, just remove the shadows)</i>`,
                    `${HTML.CodeSpan("!ets fix all")} — <b>FIX <u>ALL</u></b> text shadow objects, correcting for any errors in position or content, as well as spotting and pruning any orphaned objects from the registry.`
                ]),
                HTML.H("Fine-Tuning Shadows"),
                HTML.Paras(`The code contains further configuration options in the <b>${HTML.CodeSpan("&#42;&#42;&#42; CONFIGURATION &#42;&#42;&#42;")}</b> section, where you can change the color of the shadows and adjust the amount of offset for specific fonts and sizes.`),
                HTML.H("Source Code & Bug Reports"),
                HTML.Paras([
                    "The most recent version of this script, as well as the place to go to submit issues, suggestions or bug reports, is <b><u><a href=\"https://github.com/Eunomiac/-EunosTextControls\" style=\"color: blue;\">right here</a></b>.",
                    "To prevent this message from appearing on startup, click below."
                ]),
                HTML.Button("Hide Intro Message", "!ets cancelintro")
            ].join(""))
        ].join("")));
    };
    const displayAutoShadowStatus = () => {
        if (STA.TE.IsAutoRegistering) {
            alertGM(HTML.Box([
                HTML.Header("Auto-Shadowing <u><b>ACTIVE</b></u>", "#080"),
                HTML.Block(HTML.Button("Disable Auto-Shadow", "!ets toggle false"))
            ].join("")));
        } else {
            alertGM(HTML.Box([
                HTML.Header("Auto-Shadowing <u><b>INACTIVE</b></u>", "#800"),
                HTML.Block(HTML.Button("Enable Auto-Shadow", "!ets toggle true"))
            ].join("")));
        }
    };
    const displayAutoShadowToggleMenu = () => {
        alertGM(HTML.Box([
            HTML.Header("Auto-Text Shadow?"),
            HTML.Block([
                "<p>Do you want newly-created text objects to receive a shadow automatically?",
                HTML.Button("Yes", "!ets toggle true", "50%"),
                HTML.Button("No", "!ets toggle false", "50%"),
                "</p>"
            ])
        ]));
    };
    // #endregion

    // #endregion *** *** HTML *** ***

    return {Initialize};
})();

on("ready", () => EunosTextControls.Initialize(true));