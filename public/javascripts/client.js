jQuery(function($) {
    "use strict";
    var socket = io.connect('http://'+location.host+'/');

    // サーバからメッセージ表示
    socket.on('message', function(data) {
        $('#message_other').prepend($('<div/>').text("["+data.status+"]"+data.text));
    });

    // ユーザ登録イベント
    $('#regist').click(function() {
        var name    = $('#name').val();
        var gender  = $('#gender').val();
        var profile = $('#profile').val();
        if (name !== '') {
            socket.emit('regist', {name:name, gender:gender, profile:profile});
            $('#message_own').prepend($('<div/>').text(get_date()+":[regist]"+name));
            $('#input').val('');
        }
    });

    // ユーザの情報確認イベント
    $('#get').click(function() {
        var name = $('#name').val();
        if (name !== '') {
            socket.emit('get_user', {name:name});
            $('#message_own').prepend($('<div/>').text(get_date()+":[get]"+name));
            $('#input').val('');
        }
    });

    // ページ情報登録イベント
    $('#watching_page').click(function() {
        var name = $('#name').val();
        var page = $('#page').val();
        if (name !== '' && page !== '') {
            socket.emit('watching_page', {name:name, page:page});
            $('#message_own').prepend($('<div/>').text(get_date()+":[page]"+name+":"+page));
            $('#input').val('');
        }
    });


    var get_date = function() {
        return new Date().getTime();
    };
});
