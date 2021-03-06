"use strict";

const EventEmitter  = require('events');
const util          = require('util');
const child_process = require('child_process');


function slice(args, begin, end) {
    return Array.prototype.slice.call(args, begin, end);
}

function isPrimitive(v) {
    return (v === null) || ((typeof v) !== 'object') && ((typeof v) !== 'function');
}

function isNullOrUndefined(v) {
    return v === null || v === undefined;
}

function isDotPrototype(x) {
    return !isPrimitive(x) && x.hasOwnProperty('constructor');
}


function stringify(thing) {
    if (Number.isNaN(thing)) {
        return "NaN";
    } else if (isNullOrUndefined(thing)) {
        return "" + thing;
    } else {
        return JSON.stringify(thing);
    }
}


function _getID(o, where) {
    var id,
        count = 0;
    for (id in where) {
        if (where[id] === o) {
            return id;
        }
        count++;
    }
    return "n" + count;
}

function _explore(o, res) {
    var edges  = res.edges,
        nodes  = res.nodes,
        thisID = _getID(o, nodes),
        other,
        otherID,
        e;
    if (!(thisID in nodes)) {
        nodes[thisID] = o;
        for (e in edges) {
            try {
                other = edges[e].access(o);
                otherID = _explore(other, res);
                edges[e][thisID] = otherID;
            } catch (Error) {

            }
        }
    }
    return thisID;
}

function error(err) {
    err = err || Error;
    throw err.call(Object.create(err.prototype));
}

function explore(o) {
    var res = {
        nodes: {},
        edges: {
            "[[Prototype]]": Object.create(Object.prototype, {
                access: { value: x => Object.getPrototypeOf(x) }
            }),
            ".prototype": Object.create(Object.prototype, {
                access: { value: x => x.hasOwnProperty("prototype") ? x.prototype : error() }
            }),
            ".constructor": Object.create(Object.prototype, {
                access: { value: x => x.hasOwnProperty("constructor") ? x.constructor : error() }
            }),
            ".valueOf()": Object.create(Object.prototype, {
                access: { value: x => x.hasOwnProperty("valueOf") ? x.valueOf() : error() }
                //access: { value: x => (typeof x.valueOf === "function") ? x.valueOf() : error() }
            }),
            ".name": Object.create(Object.prototype, {
                access: { value: x => x.hasOwnProperty("name") ? x.name : error() }
            }),
        }
    };
    _explore(o, res);
    return res;
}




const DotGraph = (function () {

    function DotNode(options) {
        this.attributes = {};
        this.applySpec(options);
        return this;
    };

    DotNode.autolabel = function (thing) {
        var label;
        if (isPrimitive(thing)) {
            if (isNullOrUndefined(thing)) {
                label = "" + thing;
            } else {
                label = (typeof thing) + '\n' + stringify(thing);
            }
        } else if (Object.prototype.hasOwnProperty.call(thing, 'constructor')) {
            label = (typeof thing) + "\n" + thing.constructor.name + ".prototype";
        } else if (typeof thing === "object") {
            if ((typeof thing.valueOf === "function") && isPrimitive(thing.valueOf())) {
                label = "object\nnew " + thing.constructor.name + "(" + JSON.stringify(thing.valueOf()) + ")";
            } else {
                label = "object\nnew " + thing.constructor.name + "(...)";
            }
        } else if (typeof thing === "function") {
            if (thing.name) {
                label = "function\n" + thing.name;
            } else {
                label = "function";
            }
        } else if (isPrimitive(thing)) {
            label = (typeof thing) + "\n" + JSON.stringify(thing);
        }
        return label;
    };

    DotNode.prototype.applySpec = function (spec) {
        for (var k in spec) {
            switch (k) {
                case "id":
                case "rank":
                case "represents":
                    this[k] = spec[k];
                    break;
                case "invis":
                    this.attributes.style = "invis";    // boolean options to go into attributes.style
                    break;
                default:
                    this.attributes[k] = spec[k];
            }
        }
        if (isNullOrUndefined(this.attributes.label)) {
            this.attributes.label = DotNode.autolabel(this.represents);
        }
    };

    DotNode.prototype.def = function () {
        var attrStr = Object.keys(this.attributes).map(a =>
            a + '='
            + (a === 'label'
                ? '"' + ("" + this.attributes[a]).split('\\N').map(JSON.stringify).map(s => s.substr(1, s.length-2)).join('\\N') + '"'
                : this.attributes[a]
            )
        );
        return this.id + '[' + attrStr.join(',') + '];';
    };
    DotNode.prototype.toString = function () {
        return this.id;
    };

    const DotRank = (function () {
        var ctor = function (graph) {
            this.graph = graph;
            this.index = graph.ranks.length;
            this.dummyNode = new DotNode({
                id:    "_dummy" + this.index,
                rank:  this,
                label: this.index,
                represents: this,
                shape: "box",
                //fixedsize: true,
                //height: 0.3,
                invis: true,
            });
            this.nodes = [];
            return this;
        };
        ctor.prototype.toString = function () {
            var indent1 = '    ';
            var indent2 = indent1 + '    ';
            var res = indent1 + '{ rank=';
            if (this.index === 0) {
                res += 'min';
            } else if (this.index === this.graph.ranks.length - 1) {
                res += 'max';
            } else {
                res += 'same';
            }
            res += '; ' + this.dummyNode.def() + '\n';
            res += this.nodes.map(n => indent2 + n.def()).join('\n');
            res += '\n' + indent1 + '}\n';
            return res;
        };
        ctor.prototype.addNode = function (dotNode) {
            this.nodes.push(dotNode);
            return dotNode;
        };
        return ctor;
    }());

    function DotGraph(options) {
        var attr,
            accessor;
        options = options || {};
        this.ranks = [];
        this.edges = [];
        this.nodesMap = new Map();
        this.nodeTemplates = [];
        this.edgeTemplates = [];
        this.attributes = Object.create(this.attributes);   // inherit from default attributes
        for (var attr in options || {}) {
            var accessor = this[attr];
            if (util.isFunction(accessor)) {
                accessor.call(this, options[attr]);
            } else {
                throw new Error("invalid graph attribute " + attr);
            }
        }
        EventEmitter.call(this);
        return this;
    };

    util.inherits(DotGraph, EventEmitter);

    DotGraph.digraph = function () {
        return DotGraph.label(arguments[0] || "");
    };

    DotGraph.prototype.attributes = {
        label:    null,
        fontname: "Arial",
        fontsize: 18,
        labelloc: "t",  // top
        compound: true, // allow edges between clusters
        rankdir:  "TB",
    };
    Object.keys(DotGraph.prototype.attributes).forEach(graphAttr => {
        DotGraph.prototype[graphAttr] = function (attrValue) {
            if (arguments.length === 0) {
                return this.attributes[graphAttr];
            } else {
                this.attributes[graphAttr] = attrValue;
                return this;
            }
        };
        DotGraph[graphAttr] = function (attrValue) {
            if (arguments.length === 0) {
                throw new TypeError("missing argument for static method DotGraph." + graphAttr);
            }
            return new DotGraph()[graphAttr](attrValue);
        };
    });

    DotGraph.prototype.rank = function (i) {
        var n = this.ranks.length;
        while (n <= i) {
            this.ranks.push(new DotRank(this));
            n++;
        }
        return this.ranks[i];
    };

    DotGraph.prototype.nodeIf = function (pred, attributes) {
        this.nodeTemplates.push(node => {
            if (pred(node.represents)) {
                node.applySpec(attributes);
            }
            return node;
        });
    }

    DotGraph.prototype.edgeIf = function (pred, attributes) {
        this.edgeTemplates.push(edge => {
            if (pred(edge.from.represents, edge.to.represents)) {
                Object.assign(edge.attributes, attributes);
            }
            return edge;
        });
    }

    DotGraph.prototype.addNode = function (nodespec) {
        var node,
            repr,
            id;
        repr = nodespec.represents;
        if (this.nodesMap.has(repr)) {
            throw new Error("duplicate node for " + util.inspect(repr));
        }
        nodespec = nodespec || {};
        id = typeof repr;
        if (id === "symbol") {
            id = "x";
        } else {
            id = id.substr(0, 1);
        }
        id += this.nodesMap.size;
        nodespec.id = id;
        node = new DotNode(nodespec);
        this.nodesMap.set(repr, node);
        this.emit('node', repr);
        return node;
    };

    DotGraph.prototype.node = function (repr, nodespec) {
        var node;
        nodespec = nodespec || {};
        if (this.nodesMap.has(repr)) {
            node = this.nodesMap.get(repr);
            node.applySpec(nodespec);
        } else {
            node = this.addNode(Object.assign({}, nodespec, { represents: repr }));
        }
    };

    DotGraph.prototype.addPath = function () {
        var args  = slice(arguments),
            n     = args.length,
            edges = [],
            i, from, to;
        to = this.nodesMap.get(args[0]) || this.addNode({represents: args[0]});
        for (i = 1; i < n; i++) {
            from = to;
            to = this.nodesMap.get(args[i]) || this.addNode({represents: args[i]});
            edges.push({ from: from, to: to, attributes: {} });
        }
        edges.forEach(e => this.edges.push(e));
        var where = {
            where: edgeOptions => {
                edges.forEach(e => Object.assign(e.attributes, edgeOptions));
                return where;
            },
        };
        return where;
    };

    DotGraph.prototype.toString = function () {
        var res    = '',
            indent = '    ',
            attr;
        res += 'digraph ' + (this.label() ? JSON.stringify(this.label()) + ' ' : '') + '{\n';
        for (attr in this.attributes) { // including defaults from this.attributes.prototype
            res += indent + attr + '=' + JSON.stringify(this.attributes[attr]) + ';\n';
        }
        res += '\n';
        res += indent + 'node[fontname=Arial,fontsize=12];\n\n';

        var nodesInNoRank = [];
        this.nodesMap.forEach((node, represents) => {
            this.nodeTemplates.forEach(t => t(node));
            if (node.rank === undefined) {
                nodesInNoRank.push(node);
            } else {
                this.rank(node.rank).addNode(node);
            }
        });
        if (this.ranks.length > 0) {
            res += indent + '/* ' + this.ranks.length + ' ranks */\n';
            res += this.ranks.join('');
            res += indent + this.ranks.map(r => r.dummyNode.id).join('->') + '[style=invis];\n';
        }

        if (nodesInNoRank.length > 0) {
            res += '\n' + indent + nodesInNoRank.map(n => n.def()).join('\n' + indent) + '\n';
        }

        res += '\n' + indent + '/* ' + this.edges.length + ' edges */\n';
        res += this.edges.map(
            e => {
                this.edgeTemplates.forEach(t => t(e));
                return indent + e.from.id + '->' + e.to.id
                     + '[' + Object.keys(e.attributes).map(a => a + '=' + JSON.stringify(e.attributes[a])).join(',') + ']'
                     + ';\n';
            }
        ).join('');

        res += '\n' + indent + '/* ' + this.ranks.length + ' ranks, '
            + this.nodesMap.size + ' + ' + this.ranks.length + ' nodes, '
            + this.edges.length + ' + ' + Math.max(0, this.ranks.length-1) + ' edges'
            + ' */\n';

        res += '}\n';
        return res;
    };

    DotGraph.prototype.render = function (opts) {
        var dotInput,
            dot     = 'dot.exe',
            dotArgs,
            outFile;
        opts = opts || {};
        if (!opts.format) {
            opts.format = "svg";
        }
        if (!opts.output) {
            opts.output = "../test";
        }
        if (!opts.hasOwnProperty('show')) {
            opts.show = true;
        }
        outFile = opts.output + "." + opts.format;
        dotArgs = [
            "-T" + opts.format,
            "-o" + outFile,
        ];

        dotInput = this.toString();
        console.log(dotInput);
        var child = child_process.execFileSync('dot.exe', dotArgs, {
            //cwd: ,
            input: dotInput,
        });
        if (opts.show) {
            child_process.execFile('c:\\Programme\\Google\\Chrome\\Application\\chrome.exe', [outFile]);
        }
        return this;
    };


    return DotGraph;
}());


function toDot(x) {
    const colors = [
        "black",
        "green",
        "blue",
        "red",
        "pink",
    ];
    var res = "digraph {",
        n, o, i, c, e,
        ranks = [],
        attrs, label;
    for (n in x.nodes) {
        o = x.nodes[n];
        attrs = '';
        switch (typeof o) {
            case "function":
                attrs = 'label="function\\n' + o.name + '"'
                      + ',fontname="Arial"'
                      + ',name=' + JSON.stringify(util.inspect(o))
                ;
                break;
            case "object":
                attrs = 'label="' + (o === null ? "null" : "object") + '"'
                ;
                break;
            case "string":
                attrs = 'label="string\\n' + JSON.stringify(JSON.stringify(o)).substr(1)
                ;
                break;
            default:
                attrs = 'label="' + (typeof o) + "\\n" + util.inspect(o) + '"'
                ;
        }
        /*
        if (o !== null && o !== undefined) {
            Object.keys(o).forEach(e => {
                label += "\\n." + e + ": "; // + util.inspect(o[e]);
            });
        }
        */
        res += '\n    ' + n + '[' + attrs + '];';
    }
    res += "\n";
    i = 0;
    for (n in x.edges) {
        if (n !== ".constructor") {
            c = colors[i % colors.length];
            i++;
            label = '[label="' + n + '"]';
            res += "\n    "
                + "/* " + n + " */"
                + "\n    edge[color=" + c + ",fontcolor=" + c
                + (n === "[[Prototype]]" ? ",weight=10,style=bold" : ",weight=1,style=solid")
                + "];";
            for (e in x.edges[n]) {
                res += "\n    " + e + "->" + x.edges[n][e] + label + ";";
                label = "";
            }
            res += "\n";
        }
    }
    res += "\n}";
    return res;
}


module.exports = DotGraph;

