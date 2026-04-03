const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');
const taskService = require('../services/taskService');
const calendarService = require('../services/calendarService');
const { requireAuth } = require('../middleware/auth');

router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await dbService.getAllTasks(null);
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error.message);
    res.status(500).json({ error: 'タスクの取得に失敗しました' });
  }
});

router.post('/tasks/add', requireAuth, async (req, res) => {
  try {
    const { title, dueDate, dueTime, priority, category, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });
    const taskData = { title, dueDate: dueDate||null, dueTime: dueTime||null, priority: priority||'medium', category: category||'その他', notes: notes||null, source: 'Web手動追加' };
    const tokens = req.session.googleTokens;
    const registered = await taskService.registerTask(taskData, tokens, null);
    res.json({ task: registered });
  } catch (error) {
    console.error('Add task error:', error.message);
    res.status(500).json({ error: 'タスクの追加に失敗しました', detail: error.message });
  }
});

router.patch('/tasks/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const tasks = await dbService.getAllTasks(null);
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });
    const tokens = req.session.googleTokens;
    if (task.google_task_id && tokens) { try { await taskService.completeGoogleTask(task.google_task_id, tokens); } catch(e) {} }
    if (task.google_event_id && tokens) { try { await calendarService.markEventDone(task.google_event_id, tokens); } catch(e) {} }
    await dbService.updateTaskStatus(id, 'completed');
    res.json({ success: true });
  } catch (error) {
    console.error('Complete task error:', error.message);
    res.status(500).json({ error: 'タスクの完了処理に失敗しました' });
  }
});

router.delete('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const tasks = await dbService.getAllTasks(null);
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });
    const tokens = req.session.googleTokens;
    if (task.google_task_id && tokens) { try { await taskService.deleteGoogleTask(task.google_task_id, tokens); } catch(e) {} }
    if (task.google_event_id && tokens) { try { await calendarService.deleteEvent(task.google_event_id, tokens); } catch(e) {} }
    await dbService.deleteTask(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error.message);
    res.status(500).json({ error: 'タスクの削除に失敗しました' });
  }
});

router.get('/calendar/events', requireAuth, async (req, res) => {
  try {
    const tokens = req.session.googleTokens;
    const events = await calendarService.getThisWeekEvents(tokens);
    res.json({ events });
  } catch (error) {
    console.error('Calendar events error:', error.message);
    res.status(500).json({ error: 'カレンダーの取得に失敗しました', detail: error.message });
  }
});

module.exports = router;
