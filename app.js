"use strict";
var express = require('express')
  , routes = require('./routes')
  , http = require('http')
  , path = require('path')
  , mongoose = require('mongoose');

var Schema = mongoose.Schema;
mongoose.connect('mongodb://localhost/shokupan');

//ユーザのスキーマ定義
var UserSchema = new Schema({
    name: {type: String},
    demographic: {
        gender: String
    },
    profile: {type: String}
});
var User = mongoose.model('User', UserSchema);

//ユーザが見ているページのスキーマ定義
var PageSchema = new Schema({
    url_hash: {type: String},
    user: {type: String},
    session_id: {type: String},
    timestamp: {type: Number},
    status: {type: String}
});
var Page = mongoose.model('Page', PageSchema);


var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

app.get('/', routes.index);

var server = http.createServer(app);
server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});


var io = require('socket.io').listen(server);
// ロジック本体
io.sockets.on('connection',function(socket){

    // ユーザ登録リクエスト
    socket.on('regist', function(data){
        console.log("[regist]"+data.name);

        User.findOne({name: data.name}, "name profile demographic.gender", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                return;
            }

            if (user !== null) {
                // すでに登録済みの場合は情報アップデート
                user.profile = data.profile;
                user.demographic = {gender: data.gender};

                user.save(function(err) {
                    socket.json.emit('message', {text:"update:"+user.name});
                });

            } else {
                // まだ登録されていないのでアップデート
                var new_user = new User({
                    name: data.name,
                    profile : data.profile,
                    demographic : { gender : data.gender }
                });

                new_user.save(function(err) {
                    socket.json.emit('message', {text:"regist:"+new_user.name});
                });
            }
        });
    });

    // ユーザ確認
    socket.on('get_user', function(data){
        console.log("[get_user]"+data.name);

        User.findOne({name: data.name}, "name profile demographic.gender", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                return;
            }

            if (user !== null) {
                socket.broadcast.json.emit('message', {text:"get_user:"+user.name});
            } else {
                socket.broadcast.json.emit('message', {text:"get_user:not found"});
            }
        });
    });

    // 見ているページ確認とぶつかる判定
    socket.on('watching_page', function(data){
        console.log("[watching_page]"+data.name+":"+data.page);

        // まずはアクセスしてきたユーザが見ているページを登録
        Page.findOne({user: data.name}, "user", function(err, page) {
            if (err !== null) {
                console.error("error:"+err);
                return;
            }

            var session_id = socket.id;
            var now = new Date().getTime();

            if (page !== null) {
                // 過去に見ていたページがある場合はアップデート
                page.url_hash = data.page;
                page.timestamp = now;
                page.session_id = session_id;
                page.status = "connect";
                page.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        return;
                    }
                });

            } else {
                // 過去に見ていたページがない場合は新規登録
                var new_page = new Page({
                    user: data.name,
                    url_hash: data.page,
                    timestamp: now,
                    session_id: session_id,
                    status: "connect"
                });
                new_page.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        return;
                    }
                });
            }

            // 同じページを見ている人を探す
            // 時間的に近い人を優先するため、timestampの逆順でソート
            Page.find({url_hash: data.page, status: "connect"}, "user url_hash timestamp session_id", {sort: {"timestamp": -1}}, function(err, pages) {
                if (err !== null) {
                    console.error("error:"+err);
                    return;
                }

                for (var i in pages) {
                    var page = pages[i];

                    // 自分自身ははじく
                    if (page.user === data.user) {
                        continue;
                    }

                    // 古すぎるものもはじく (単位はms)
                    if (now - page.timestamp > 3600000) {
                        break;
                    }

                    console.log("[butsukatta]"+data.name+"<=>"+page.user);

                    // アクセスしてきた人に返す
                    socket.json.emit("message", {text: "butsukatta!! jibun"});
                    // ぶつかった人に返す
                    io.sockets.socket(page.session_id).json.emit("message", {text: "butsukatta!! aite"});

                    return;
                }
            });
        });
    });
});
