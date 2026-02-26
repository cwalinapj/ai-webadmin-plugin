(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var forms = document.querySelectorAll('.webadmin-edge-agent form');
        forms.forEach(function (form) {
            form.addEventListener('submit', function () {
                var button = form.querySelector('button[type="submit"]');
                if (button) {
                    button.setAttribute('disabled', 'disabled');
                }
            });
        });
    });
})();
