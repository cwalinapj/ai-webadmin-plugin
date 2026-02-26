<?php
$_tests_dir = getenv('WP_TESTS_DIR');
if (!$_tests_dir) {
    $_tests_dir = '/tmp/wordpress-tests-lib';
}

if (!defined('WP_TESTS_PHPUNIT_POLYFILLS_PATH')) {
    $polyfills = getenv('WP_TESTS_PHPUNIT_POLYFILLS_PATH') ?: '/tmp/wp-phpunit-polyfills';
    define('WP_TESTS_PHPUNIT_POLYFILLS_PATH', $polyfills);
}

if (!file_exists($_tests_dir . '/includes/functions.php')) {
    fwrite(STDERR, "WP test suite not found in $_tests_dir\n");
    exit(1);
}

require_once $_tests_dir . '/includes/functions.php';

function _ddns_toll_comments_load_plugin() {
    require dirname(__FILE__) . '/../toll-comments.php';
}

tests_add_filter('muplugins_loaded', '_ddns_toll_comments_load_plugin');

require $_tests_dir . '/includes/bootstrap.php';
