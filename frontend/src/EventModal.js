import React, { useState, useEffect } from 'react';
import Modal from 'react-modal';
import moment from 'moment';
import './EventModal.css';

Modal.setAppElement('#root');

const EventModal = ({ isOpen, onClose, onSave, onDelete, selectedDate, event }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    color: '#3788d8'
  });

  useEffect(() => {
    if (event) {
      setFormData({
        title: event.title,
        description: event.description || '',
        start_date: event.start_date,
        end_date: event.end_date,
        start_time: event.start_time || '',
        end_time: event.end_time || '',
        color: event.color || '#3788d8'
      });
    } else {
      const dateStr = moment(selectedDate).format('YYYY-MM-DD');
      setFormData({
        title: '',
        description: '',
        start_date: dateStr,
        end_date: dateStr,
        start_time: '',
        end_time: '',
        color: '#3788d8'
      });
    }
  }, [event, selectedDate, isOpen]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleDelete = () => {
    if (window.confirm('确定要删除这个事件吗？')) {
      onDelete(event.id);
    }
  };

  const colors = [
    '#3788d8', '#41b883', '#e6a23c', '#f56c6c', 
    '#9b59b6', '#34495e', '#e67e22', '#1abc9c'
  ];

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      className="event-modal"
      overlayClassName="modal-overlay"
    >
      <div className="modal-header">
        <h2>{event ? '编辑事件' : '添加事件'}</h2>
        <button className="close-btn" onClick={onClose}>&times;</button>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>标题 *</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            placeholder="输入事件标题"
          />
        </div>

        <div className="form-group">
          <label>描述</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="输入事件描述"
            rows="3"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>开始日期 *</label>
            <input
              type="date"
              name="start_date"
              value={formData.start_date}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>开始时间</label>
            <input
              type="time"
              name="start_time"
              value={formData.start_time}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>结束日期 *</label>
            <input
              type="date"
              name="end_date"
              value={formData.end_date}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>结束时间</label>
            <input
              type="time"
              name="end_time"
              value={formData.end_time}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="form-group">
          <label>颜色</label>
          <div className="color-picker">
            {colors.map(color => (
              <div
                key={color}
                className={`color-option ${formData.color === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setFormData({...formData, color})}
              />
            ))}
          </div>
        </div>

        <div className="modal-footer">
          {event && (
            <button type="button" className="delete-btn" onClick={handleDelete}>
              删除
            </button>
          )}
          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="save-btn">
              保存
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default EventModal;