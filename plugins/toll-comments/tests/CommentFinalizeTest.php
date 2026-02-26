<?php
class TollCommentsFinalizeTest extends WP_UnitTestCase {
    public function test_finalize_runs_on_approval() {
        update_option('ddns_toll_comments_enabled', true);
        update_option('ddns_toll_comments_bonus_enabled', true);
        update_option('ddns_toll_comments_bonus_multiplier', 2);

        $comment_id = $this->factory->comment->create(array(
            'comment_post_ID' => $this->factory->post->create(),
            'comment_content' => 'Test comment'
        ));

        add_comment_meta($comment_id, 'ddns_toll_ticket_id', 'ticket-123', true);
        add_comment_meta($comment_id, 'ddns_toll_wallet', '0xabc', true);

        $comment = get_comment($comment_id);
        ddns_toll_comments_transition_comment_status('approved', 'pending', $comment);

        $this->assertSame('ticket-123', get_comment_meta($comment_id, 'ddns_toll_ticket_id', true));
    }
}
