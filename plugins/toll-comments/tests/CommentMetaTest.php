<?php
class TollCommentsMetaTest extends WP_UnitTestCase {
    public function test_ticket_meta_is_stored() {
        $comment_id = $this->factory->comment->create(array(
            'comment_post_ID' => $this->factory->post->create(),
            'comment_content' => 'Test comment'
        ));

        $GLOBALS['ddns_toll_comments_last_payment'] = array(
            'ticket_id' => 'ticket-123',
            'wallet' => '0xabc',
            'comment_hash' => 'hash'
        );

        ddns_toll_comments_store_comment_meta($comment_id);

        $this->assertSame('ticket-123', get_comment_meta($comment_id, 'ddns_toll_ticket_id', true));
        $this->assertSame('0xabc', get_comment_meta($comment_id, 'ddns_toll_wallet', true));
    }
}
