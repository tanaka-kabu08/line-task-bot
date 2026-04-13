const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');
const taskService = require('../services/taskService');
const calendarService = require('../services/calendarService');
const { requireAuth } = require('../middleware/auth');

// GET /api/tasks - タスク一覧取得
router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const lineUserId = req.session.lineUserId || null;
    if (!lineUserId) {
      return res.json({ tasks: [] }); // LINE未連携の場合は空を返す
    }
    const tasks = await dbService.getAllTasks(lineUserId);
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error.message);
    res.status(500).json({ error: 'タスクの取得に失敗しました' });
  }
});

// POST /api/tasks/add - タスクを手動追加
router.post('/tasks/add', requireAuth, async (req, res) => {
  try {
    const { title, dueDate, dueTime, priority, category, notes } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'タイトルは必須です' });
    }

    const taskData = {
      title,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority: priority || 'medium',
      category: category || 'その他',
      notes: notes || null,
      source: 'Web手動追加'
    };

    const tokens = req.session.googleTokens;
    const registered = await taskService.registerTask(taskData, tokens, null);
    res.json({ task: registered });
  } catch (error) {
    console.error('Add task error:', error.message);
    res.status(500).json({ error: 'タスクの追加に失敗しました', detail: error.message });
  }
});

// PATCH /api/tasks/:id/complete - タスクを完了にする
router.patch('/tasks/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const lineUserId = req.session.lineUserId || null;
    if (!lineUserId) return res.status(403).json({ error: 'LINE連携が必要です' });
    const tasks = await dbService.getAllTasks(lineUserId);
    const task = tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'タスクが見つかりません' });
    }

    const tokens = req.session.googleTokens;

    // Google Tasks を完了にする
    if (task.google_task_id && tokens) {
      try {
        await taskService.completeGoogleTask(task.google_task_id, tokens);
      } catch (e) {
        console.error('Google Tasks complete error:', e.message);
      }
    }

    // Google Calendar のイベントに完了マークを付ける
    if (task.google_event_id && tokens) {
      try {
        await calendarService.markEventDone(task.google_event_id, tokens);
      } catch (e) {
        console.error('Calendar mark done error:', e.message);
      }
    }

    await dbService.updateTaskStatus(id, 'completed');
    res.json({ success: true });
  } catch (error) {
    console.error('Complete task error:', error.message);
    res.status(500).json({ error: 'タスクの完了処理に失敗しました' });
  }
});

// DELETE /api/tasks/:id - タスクを削除
router.delete('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const lineUserId = req.session.lineUserId || null;
    if (!lineUserId) return res.status(403).json({ error: 'LINE連携が必要です' });
    const tasks = await dbService.getAllTasks(lineUserId);
    const task = tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'タスクが見つかりません' });
    }

    const tokens = req.session.googleTokens;

    // Google Tasks から削除
    if (task.google_task_id && tokens) {
      try {
        await taskService.deleteGoogleTask(task.google_task_id, tokens);
      } catch (e) {
        console.error('Google Tasks delete error:', e.message);
      }
    }

    // Google Calendar から削除
    if (task.google_event_id && tokens) {
      try {
        await calendarService.deleteEvent(task.google_event_id, tokens);
      } catch (e) {
        console.error('Calendar delete event error:', e.message);
      }
    }

    await dbService.deleteTask(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error.message);
    res.status(500).json({ error: 'タスクの削除に失敗しました' });
  }
});

// GET /api/calendar/events - 今週のカレンダー予定取得
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
