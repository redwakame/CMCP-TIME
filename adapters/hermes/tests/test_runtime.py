import sys, unittest, threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cmcp_hermes_runtime import HostRuntime
from controls import apply_control

def fixture(enabled=True, synthetic=False, save=True):
    r=HostRuntime.__new__(HostRuntime)
    r.session_id='s';r.turn_id='t';r.text='合成原文';r.authorized=enabled;r.synthetic_evidence=synthetic;r.begun=enabled;r.failure=None;r.finished=False;r.api_calls=0;r.api_failures=0
    r.lock=threading.RLock()
    r.rows=[];r.note=lambda kind,value:r.rows.append({'kind':kind,**value})
    def call(op,args=None):
        if not save and op in ('assistant','finish'):raise RuntimeError('hermes_assistant_not_saved')
        return {'status':'stored','sourcePointer':{'synthetic':True}}
    r.call=call
    return r

class Tests(unittest.TestCase):
    def test_daily_answer_metadata_only(self):
        r=fixture();r.after(session_id='s',turn_id='t',assistant_response='私人測試替身正文')
        self.assertTrue(r.finished);self.assertNotIn('assistantText',r.rows[-1])
    def test_disabled_never_copies_answer(self):
        r=fixture(enabled=False,synthetic=True);r.after(session_id='s',turn_id='t',assistant_response='不得旁路')
        self.assertFalse(r.finished);self.assertNotIn('assistantText',r.rows[-1])
    def test_stopped_save_never_copies_answer(self):
        r=fixture(synthetic=True,save=False);r.after(session_id='s',turn_id='t',assistant_response='晚到原答')
        self.assertFalse(r.finished);self.assertEqual(r.failure,'hermes_assistant_not_saved');self.assertNotIn('assistantText',r.rows[-1])
    def test_synthetic_saved_answer_keeps_original(self):
        r=fixture(synthetic=True);r.after(session_id='s',turn_id='t',assistant_response='合成原答')
        self.assertEqual(r.rows[-1]['assistantText'],'合成原答')
    def test_api_only_hashes_even_in_synthetic_mode(self):
        r=fixture(synthetic=True);r.api_started(model='deepseek-flash',request_messages=[{'role':'user','content':'原始內容'},{'role':'assistant','content':'可見文字','reasoning_content':'不可蒐集'}])
        text=str(r.rows);self.assertNotIn('原始內容',text);self.assertNotIn('不可蒐集',text);self.assertNotIn('可見文字',text);self.assertEqual(len(r.rows[0]['materialHashes']),2)
        self.assertEqual(r.rows[0]['materialObservation']['status'],'observed')
    def test_missing_official_request_messages_is_unknown(self):
        r=fixture();r.api_started(request={'messages':[{'role':'user','content':'不能冒充正式接點'}]})
        self.assertEqual(r.rows[0]['materialObservation']['status'],'unavailable');self.assertIsNone(r.rows[0]['visibleProjectionHash']);self.assertEqual(r.rows[0]['materialHashes'],[])
    def test_wrong_reply_binding_not_saved(self):
        r=fixture(synthetic=True);r.after(session_id='wrong',turn_id='t',assistant_response='誤綁')
        self.assertFalse(r.finished);self.assertEqual(r.rows,[])
    def test_parent_cancel_rejects_late_answer_and_calls_native_interrupt(self):
        r=fixture(synthetic=True);calls=[]
        class Agent:
            def interrupt(self,**kwargs):calls.append(kwargs)
        self.assertFalse(apply_control(r,Agent(),{"type":"cancel","requestId":"other"},"active"))
        self.assertIsNone(r.failure)
        self.assertTrue(apply_control(r,Agent(),{"type":"cancel","requestId":"active"},"active"))
        self.assertEqual(calls,[{"hard_cancel":True}]);self.assertEqual(r.failure,"hermes_cancelled")
        r.after(session_id='s',turn_id='t',assistant_response='晚到答案')
        self.assertFalse(r.finished);self.assertNotIn('assistantText',r.rows[-1])
        self.assertIn('已停止',r.before(session_id='s',user_message='合成原文',turn_id='t')['context'])

if __name__=='__main__':unittest.main()
