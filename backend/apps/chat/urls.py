from django.urls import path
from .views import (
    ChatMessageListCreateView, ChatInboxView,
    ConversationListView, ConversationMessagesView,
    ConversationWhatsAppView, ConversationWhatsAppApproveView,
    ConversationReportView, ConversationBlockView
)

urlpatterns = [
    path('messages/', ChatMessageListCreateView.as_view(), name='chat-messages'),
    path('inbox/', ChatInboxView.as_view(), name='chat-inbox'),
    path('conversations/', ConversationListView.as_view(), name='chat-conversations'),
    path('conversations/<str:conversation_id>/messages/', ConversationMessagesView.as_view(), name='chat-conversation-messages'),
    path('conversations/<str:conversation_id>/whatsapp/', ConversationWhatsAppView.as_view(), name='chat-conversation-whatsapp'),
    path('conversations/<str:conversation_id>/whatsapp/approve/', ConversationWhatsAppApproveView.as_view(), name='chat-conversation-whatsapp-approve'),
    path('conversations/<str:conversation_id>/report/', ConversationReportView.as_view(), name='chat-conversation-report'),
    path('conversations/<str:conversation_id>/block/', ConversationBlockView.as_view(), name='chat-conversation-block'),
]
