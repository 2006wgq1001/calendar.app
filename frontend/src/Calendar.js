import React from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import 'moment/locale/zh-cn';
import './Calendar.css';

moment.locale('zh-cn');

const Calendar = ({ events, onDateClick, onEventClick, currentMonth, setCurrentMonth, loading, error }) => {
  const navigate = useNavigate();

  const renderHeader = () => {
    const monthFormat = moment(currentMonth).format('YYYY年MM月');
    return (
      <div className="calendar-header">
        <button className="back-btn" onClick={() => navigate('/')}>返回</button>
        <button onClick={() => setCurrentMonth(moment(currentMonth).subtract(1, 'month').toDate())}>
          &lt;
        </button>
        <h2>{monthFormat}</h2>
        <button onClick={() => setCurrentMonth(moment(currentMonth).add(1, 'month').toDate())}>
          &gt;
        </button>
        <input
          type="date"
          value={moment(currentMonth).format('YYYY-MM-DD')}
          onChange={(e) => setCurrentMonth(new Date(e.target.value))}
          className="date-picker"
        />
        <button className="today-btn" onClick={() => setCurrentMonth(new Date())}>
          今天
        </button>
      </div>
    );
  };

  const renderDays = () => {
    const days = [];
    const weekdays = moment.weekdaysShort();
    
    for (let i = 0; i < 7; i++) {
      days.push(
        <div className="calendar-weekday" key={i}>
          {weekdays[i]}
        </div>
      );
    }
    
    return <div className="calendar-weekdays">{days}</div>;
  };

  const renderCells = () => {
    const monthStart = moment(currentMonth).startOf('month');
    const monthEnd = moment(currentMonth).endOf('month');
    const startDate = moment(monthStart).startOf('week');
    const endDate = moment(monthEnd).endOf('week');
    
    const rows = [];
    let days = [];
    let day = moment(startDate);
    let rowKey = 0;
    
    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const cloneDay = moment(day);
        const dayEvents = events.filter(event => 
          moment(event.start_date).isSame(cloneDay, 'day')
        );
        
        days.push(
          <div
            className={`calendar-cell ${
              !cloneDay.isSame(monthStart, 'month') ? 'other-month' : ''
            } ${cloneDay.isSame(new Date(), 'day') ? 'today' : ''}`}
            key={cloneDay.format('YYYY-MM-DD')}
            onClick={() => onDateClick(cloneDay.toDate())}
          >
            <span className="calendar-date">{cloneDay.format('D')}</span>
            <div className="calendar-events">
              {dayEvents.slice(0, 2).map((event) => (
                <div
                  key={event.id}
                  className="calendar-event"
                  style={{ backgroundColor: event.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(event);
                  }}
                >
                  {event.title}
                </div>
              ))}
              {dayEvents.length > 2 && (
                <div className="calendar-event-more">
                  +{dayEvents.length - 2}
                </div>
              )}
            </div>
          </div>
        );
        day = moment(day).add(1, 'day');
      }
      
      rows.push(
        <div className="calendar-row" key={rowKey++}>
          {days}
        </div>
      );
      days = [];
    }
    
    return <div className="calendar-body">{rows}</div>;
  };

  return (
    <div className="calendar">
      {renderHeader()}
      {renderDays()}
      {error ? (
        <div className="calendar-error">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      ) : loading ? (
        <div className="calendar-loading">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      ) : (
        renderCells()
      )}
    </div>
  );
};

export default Calendar;